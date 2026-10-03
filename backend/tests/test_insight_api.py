from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
import pytest
from psycopg.types.json import Jsonb

from tests.conftest import auth_for

PROFILE = {
    "height_cm": 180,
    "sex": "male",
    "date_of_birth": "1988-10-01",
    "timezone": "Asia/Jerusalem",
}
TZ = ZoneInfo("Asia/Jerusalem")
TODAY = date(2026, 3, 1)  # FIXED_NOW's local date: a Sunday, the default check-in day


def seed(db: str, user, days: int = 28, kcal: float = 2000, start_weight: float = 85) -> None:
    """`days` days up to today: one quick add of `kcal` at noon, and a weigh-in losing
    0.05 kg a day (0.35 kg a week)."""
    with psycopg.connect(db) as conn:
        for i in range(days):
            day = TODAY - timedelta(days=days - 1 - i)
            noon = datetime(day.year, day.month, day.day, 12, tzinfo=TZ)
            conn.execute(
                "insert into food_log (user_id, eaten_at, meal, name, nutrients)"
                " values (%s, %s, 'lunch', 'Quick add', %s)",
                (user, noon, Jsonb({"energy_kcal": kcal, "protein_g": 150})),
            )
            conn.execute(
                "insert into body_entries (user_id, measured_at, weight_kg) values (%s, %s, %s)",
                (user, noon - timedelta(hours=5), round(start_weight - 0.05 * i, 2)),
            )


def add_target(db: str, user, effective_from: str, kcal: int, protein: int = 170) -> None:
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into nutrition_targets (user_id, effective_from, energy_kcal, protein_g,"
            " carbs_g, fat_g, fiber_g, origin) values (%s, %s, %s, %s, 250, 65, 30, 'manual')",
            (user, effective_from, kcal, protein),
        )


@pytest.fixture
def profile(client, headers) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200


def tdee(client, headers) -> dict[str, Any]:
    res = client.get("/nutrition/tdee", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def suggestion(client, headers) -> Any:
    res = client.get("/nutrition/suggestion", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_tdee_from_four_weeks_of_data(client, headers, user, db, profile) -> None:
    seed(db, user)
    body = tdee(client, headers)
    # eating 2,000 a day while losing 0.35 kg a week: a burn of about 2,000 + 385
    assert body["has_data"] is True
    start = client.get("/nutrition/estimate", headers=headers).json()
    assert body["start_tdee"] == start["tdee"]  # BMR × 1.375 from the current weight trend
    assert 2340 <= body["tdee"] <= 2470
    assert body["eligible_days"] == 28
    assert [w["day"] for w in body["weekly"]] == [
        "2026-02-08",
        "2026-02-15",
        "2026-02-22",
        "2026-03-01",
    ]
    assert body["weekly"][0]["observed"] is None  # too few days yet
    assert body["weekly"][-1]["observed"] is not None
    assert body["weekly"][-1]["intake"] == 2000


def test_tdee_without_enough_data_uses_starting_estimate(
    client, headers, user, db, profile
) -> None:
    seed(db, user, days=10)
    body = tdee(client, headers)
    assert body["has_data"] is False and body["tdee"] == body["start_tdee"]
    assert suggestion(client, headers) is None


def test_tdee_needs_profile_and_weigh_in(client, headers, profile) -> None:
    res = client.get("/nutrition/tdee", headers=headers)
    assert res.status_code == 409 and res.json()["detail"] == "Log a weigh-in first"
    assert suggestion(client, headers) is None


def test_flagged_days_are_left_out(client, headers, user, db, profile) -> None:
    seed(db, user)
    for i in range(10):
        day = (TODAY - timedelta(days=i)).isoformat()
        res = client.put(f"/food-log/days/{day}/flag", json={"excluded": True}, headers=headers)
        assert res.status_code == 204
    assert tdee(client, headers)["eligible_days"] == 18
    client.put(
        f"/food-log/days/{TODAY.isoformat()}/flag", json={"excluded": False}, headers=headers
    )
    assert tdee(client, headers)["eligible_days"] == 19
    day = client.get("/food-log", params={"day": "2026-02-28"}, headers=headers).json()
    assert day["excluded"] is True


def test_half_logged_days_are_left_out(client, headers, user, db, profile) -> None:
    seed(db, user, kcal=900)  # under half of the 2,220 kcal starting target
    body = tdee(client, headers)
    assert body["eligible_days"] == 0 and body["has_data"] is False


def test_suggestion_without_targets(client, headers, user, db, profile) -> None:
    seed(db, user)
    s = suggestion(client, headers)
    t = tdee(client, headers)["tdee"]
    assert s["week_start"] == "2026-03-01" and s["current"] is None
    assert abs(s["targets"]["energy_kcal"] - 0.9 * t) <= 10  # recomp: 10% under the burn
    weight = client.get("/nutrition/estimate", headers=headers).json()["weight_kg"]
    assert s["targets"]["protein_g"] == 5 * round(2 * weight / 5)  # 2 g/kg of the weight trend
    assert s["capped"] is False and s["warning"] is None


def test_suggestion_capped_at_150(client, headers, user, db, profile) -> None:
    seed(db, user)
    add_target(db, user, "2026-02-01", 2600)
    s = suggestion(client, headers)
    assert s["targets"]["energy_kcal"] == 2450 and s["capped"] is True
    assert s["current"]["energy_kcal"] == 2600


def test_no_suggestion_when_targets_already_match(client, headers, user, db, profile) -> None:
    seed(db, user)
    s = suggestion(client, headers)
    add_target(db, user, "2026-02-01", s["targets"]["energy_kcal"] + 30, s["targets"]["protein_g"])
    assert suggestion(client, headers) is None


def test_accepting_or_editing_this_week_ends_the_check_in(
    client, headers, user, db, profile
) -> None:
    seed(db, user)
    s = suggestion(client, headers)
    body = {**s["targets"], "effective_from": "2026-03-01", "origin": "suggested"}
    assert client.post("/nutrition/targets", json=body, headers=headers).status_code == 201
    assert suggestion(client, headers) is None


def test_dismiss_for_this_week(client, headers, user, db, profile) -> None:
    seed(db, user)
    assert suggestion(client, headers) is not None
    assert client.post("/nutrition/suggestion/dismiss", headers=headers).status_code == 204
    assert client.post("/nutrition/suggestion/dismiss", headers=headers).status_code == 204
    assert suggestion(client, headers) is None


def test_check_in_day_setting_moves_the_week(client, headers, user, db, profile) -> None:
    seed(db, user)
    client.put("/nutrition/settings", json={"check_in_weekday": 3}, headers=headers)  # Thursday
    s = suggestion(client, headers)
    assert s["week_start"] == "2026-02-26"
    assert tdee(client, headers)["weekly"][-1]["day"] == "2026-02-26"


def test_insight_isolation(client, headers, user, db, make_user, profile) -> None:
    seed(db, user)
    other = auth_for(make_user())
    client.put("/me/profile", json=PROFILE, headers=other)
    assert client.get("/nutrition/tdee", headers=other).status_code == 409  # no weigh-ins
    assert suggestion(client, other) is None
    client.put("/food-log/days/2026-03-01/flag", json={"excluded": True}, headers=other)
    assert tdee(client, headers)["eligible_days"] == 28  # B's flag doesn't touch A


def test_food_days_list(client, headers, user, db, profile) -> None:
    seed(db, user, days=3)
    client.put("/food-log/days/2026-02-28/flag", json={"excluded": True}, headers=headers)
    res = client.get(
        "/food-log/days", params={"from": "2026-02-20", "to": "2026-03-01"}, headers=headers
    )
    assert res.status_code == 200
    assert res.json() == [
        {
            "day": "2026-03-01",
            "energy_kcal": 2000.0,
            "protein_g": 150.0,
            "entries": 1,
            "excluded": False,
        },
        {
            "day": "2026-02-28",
            "energy_kcal": 2000.0,
            "protein_g": 150.0,
            "entries": 1,
            "excluded": True,
        },
        {
            "day": "2026-02-27",
            "energy_kcal": 2000.0,
            "protein_g": 150.0,
            "entries": 1,
            "excluded": False,
        },
    ]
    long = client.get(
        "/food-log/days", params={"from": "2025-01-01", "to": "2026-03-01"}, headers=headers
    )
    assert long.status_code == 422
