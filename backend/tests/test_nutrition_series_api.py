import psycopg
import pytest

from tests.test_insight_api import PROFILE, seed


@pytest.fixture
def profile(client, headers) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200


def series(client, headers, metric: str, range_key: str = "1M") -> dict:
    res = client.get("/series", params={"metric": metric, "range": range_key}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_calories_series_with_seven_day_average(client, headers, user, db, profile) -> None:
    seed(db, user, days=10)
    with psycopg.connect(db) as conn:  # make the latest day bigger
        conn.execute(
            "update food_log set nutrients = '{\"energy_kcal\": 2700}'"
            " where eaten_at = (select max(eaten_at) from food_log)"
        )
    body = series(client, headers, "energy_kcal")
    assert body["unit"] == "kcal" and body["label"] == "Calories"
    assert len(body["points"]) == 10 and body["points"][-1]["value"] == 2700
    assert body["trend"][-1]["value"] == 2100  # (6 × 2,000 + 2,700) / 7
    assert body["weekly_rate"] is None
    assert body["latest"] == 2100 and body["max"] == 2700


def test_protein_series(client, headers, user, db, profile) -> None:
    seed(db, user, days=3)
    body = series(client, headers, "protein_g")
    assert [p["value"] for p in body["points"]] == [150, 150, 150]


def test_flagged_days_are_left_out_of_series(client, headers, user, db, profile) -> None:
    seed(db, user, days=3)
    client.put("/food-log/days/2026-03-01/flag", json={"excluded": True}, headers=headers)
    body = series(client, headers, "energy_kcal")
    assert [p["date"] for p in body["points"]] == ["2026-02-27", "2026-02-28"]


def test_tdee_series_steps_weekly(client, headers, user, db, profile) -> None:
    seed(db, user)
    body = series(client, headers, "tdee_kcal", "3M")
    assert [p["date"] for p in body["trend"]] == [
        "2026-02-08",
        "2026-02-15",
        "2026-02-22",
        "2026-03-01",
    ]
    tdee = client.get("/nutrition/tdee", headers=headers).json()
    assert body["latest"] == tdee["tdee"] or abs(body["latest"] - tdee["tdee"]) < 1


def test_nutrition_series_without_profile_or_weigh_in(client, headers) -> None:
    assert series(client, headers, "energy_kcal")["points"] == []
    assert series(client, headers, "tdee_kcal")["points"] == []
