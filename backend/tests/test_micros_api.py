from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.nutrient_reference import reference
from tests.test_insight_api import PROFILE, TODAY

TZ = ZoneInfo("Asia/Jerusalem")


def log(db: str, user, days_ago: int, nutrients: dict[str, float], hour: int = 12) -> None:
    day = TODAY - timedelta(days=days_ago)
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into food_log (user_id, eaten_at, meal, name, nutrients)"
            " values (%s, %s, 'lunch', 'x', %s)",
            (user, datetime(day.year, day.month, day.day, hour, tzinfo=TZ), Jsonb(nutrients)),
        )


@pytest.fixture
def profile(client, headers) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200


def micros(client, headers, window: int = 7) -> dict[str, Any]:
    res = client.get("/nutrition/micros", params={"window": window}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def by_key(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {n["key"]: n for n in body["nutrients"]}


def test_reference_values_by_sex_and_age() -> None:
    assert reference("male", 37, "magnesium_mg", 2000, None) == (420, "target")
    assert reference("male", 25, "magnesium_mg", 2000, None) == (400, "target")
    assert reference("female", 40, "iron_mg", 2000, None) == (18, "target")
    assert reference("female", 55, "iron_mg", 2000, None) == (8, "target")
    assert reference("male", 75, "vit_d_mcg", 2000, None) == (20, "target")
    assert reference("male", 37, "sodium_mg", 2000, None) == (2300, "limit")
    assert reference("male", 37, "sat_fat_g", 1800, None) == (pytest.approx(20), "limit")
    assert reference("male", 37, "fiber_g", 2000, 35) == (35, "target")
    assert reference("male", 37, "fiber_g", 2000, None) == (pytest.approx(28), "target")
    assert reference("male", 37, "sugar_g", 2000, None) is None


def test_averages_status_and_coverage(client, headers, user, db, profile) -> None:
    for i in range(3):
        log(db, user, i, {"energy_kcal": 1500, "vit_c_mg": 120, "sodium_mg": 3000, "iron_mg": 2})
        log(db, user, i, {"energy_kcal": 500, "iron_mg": 1}, hour=18)  # reports no vitamin C
    body = micros(client, headers)
    assert body["days_counted"] == 3
    n = by_key(body)
    assert n["vit_c_mg"]["average"] == 120 and n["vit_c_mg"]["coverage"] == 0.75
    assert n["vit_c_mg"]["status"] == "ok"  # 120 of 90 mg
    assert n["sodium_mg"]["status"] == "over_limit" and n["sodium_mg"]["kind"] == "limit"
    assert n["iron_mg"]["average"] == 3 and n["iron_mg"]["status"] == "low"  # 3 of 8 mg
    assert n["sugar_g"]["status"] == "no_reference"
    assert "energy_kcal" not in n and "protein_g" not in n


def test_low_coverage_is_not_reported_as_low(client, headers, user, db, profile) -> None:
    for i in range(3):
        log(db, user, i, {"energy_kcal": 500, "vit_d_mcg": 0.5})
        log(db, user, i, {"energy_kcal": 1500}, hour=18)  # most food says nothing on vitamin D
    n = by_key(micros(client, headers))
    assert n["vit_d_mcg"]["coverage"] == 0.25
    assert n["vit_d_mcg"]["status"] == "not_enough_data"
    assert n["zinc_mg"]["status"] == "not_enough_data" and n["zinc_mg"]["average"] is None


def test_window_and_flagged_days(client, headers, user, db, profile) -> None:
    log(db, user, 0, {"energy_kcal": 2000, "calcium_mg": 1200})
    log(db, user, 1, {"energy_kcal": 2000, "calcium_mg": 400})
    log(db, user, 10, {"energy_kcal": 2000, "calcium_mg": 100})
    assert by_key(micros(client, headers))["calcium_mg"]["average"] == 800
    assert micros(client, headers, 28)["days_counted"] == 3
    client.put("/food-log/days/2026-02-28/flag", json={"excluded": True}, headers=headers)
    assert by_key(micros(client, headers))["calcium_mg"]["average"] == 1200


def test_no_food_logged(client, headers, profile) -> None:
    body = micros(client, headers)
    assert body["days_counted"] == 0
    assert all(n["status"] in ("not_enough_data", "no_reference") for n in body["nutrients"])


def test_micros_need_a_profile(client, headers) -> None:
    assert client.get("/nutrition/micros", headers=headers).status_code == 409


def test_window_must_be_7_or_28(client, headers, profile) -> None:
    assert (
        client.get("/nutrition/micros", params={"window": 14}, headers=headers).status_code == 422
    )
