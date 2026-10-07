from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.services.achievement_service import CATALOGUE
from tests.conftest import auth_for

PROFILE = {
    "height_cm": 175,
    "sex": "male",
    "date_of_birth": "1988-10-01",
    "timezone": "Asia/Jerusalem",
}
FIRST = date(2025, 12, 1)  # 90 days before FIXED_NOW (2026-03-01)


@pytest.fixture
def profile(client, headers) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200


def at(day: date, hour: int = 7) -> datetime:
    # 07:00 UTC is 09:00 in Jerusalem, the same local day
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


def seed_weights(db: str, user, days: int, start: float, per_day: float) -> None:
    with psycopg.connect(db) as conn:
        for i in range(days):
            conn.execute(
                "insert into body_entries (user_id, measured_at, weight_kg) values (%s, %s, %s)",
                (user, at(FIRST + timedelta(days=i)), start + per_day * i),
            )


def trophies(client, headers) -> dict[str, dict[str, Any]]:
    res = client.get("/achievements", headers=headers)
    assert res.status_code == 200, res.text
    return {t["key"]: t for t in res.json()}


def test_needs_a_profile(client, headers) -> None:
    assert client.get("/achievements", headers=headers).json() == []


def test_backfills_from_history_and_marks_new(client, headers, user, db, profile) -> None:
    seed_weights(db, user, 60, 85.0, -0.1)  # 60 days in a row, 85 → 79.1 kg
    got = trophies(client, headers)
    assert len(got) == len(CATALOGUE)

    first = got["first_weigh_in"]
    assert first["earned_on"] == FIRST.isoformat() and first["new"] is True
    assert got["weigh_streak_7"]["earned_on"] == (FIRST + timedelta(days=6)).isoformat()
    assert got["weigh_streak_30"]["earned_on"] == (FIRST + timedelta(days=29)).isoformat()
    assert got["weight_down_1"]["earned_on"] is not None  # trend, so later than day 10
    assert got["weight_down_1"]["earned_on"] > (FIRST + timedelta(days=10)).isoformat()

    locked = got["weigh_streak_100"]
    assert (locked["earned_on"], locked["new"], locked["progress"], locked["target"]) == (
        None,
        False,
        60,
        100,
    )
    assert got["weigh_streak_30"]["progress"] == 30
    assert got["first_photo"]["progress"] == 0

    new = [k for k, t in got.items() if t["new"]]
    res = client.post("/achievements/seen", json={"keys": new}, headers=headers)
    assert res.status_code == 204
    assert not any(t["new"] for t in trophies(client, headers).values())


def test_earned_trophies_are_kept(client, headers, user, db, profile) -> None:
    seed_weights(db, user, 7, 80.0, 0)
    assert trophies(client, headers)["weigh_streak_7"]["earned_on"] is not None
    with psycopg.connect(db) as conn:
        conn.execute("delete from body_entries where user_id = %s", (user,))
    kept = trophies(client, headers)["weigh_streak_7"]
    assert kept["earned_on"] == (FIRST + timedelta(days=6)).isoformat()
    assert kept["progress"] == 7


def test_food_targets_and_habits(client, headers, user, db, profile) -> None:
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into nutrition_targets (user_id, effective_from, energy_kcal, protein_g,"
            " carbs_g, fat_g, fiber_g, origin) values (%s, %s, 2000, 150, 200, 70, 30, 'manual')",
            (user, FIRST),
        )
        for i in range(8):
            day = FIRST + timedelta(days=i)
            protein = 160 if i % 4 != 3 else 50  # days 3 and 7 miss
            for meal_hour, origin in ((7, "manual"), (12, "ai_photo")):
                conn.execute(
                    "insert into food_log (user_id, eaten_at, meal, name, nutrients, origin)"
                    " values (%s, %s, 'lunch', 'x', %s, %s)",
                    (
                        user,
                        at(day, meal_hour),
                        Jsonb({"energy_kcal": 1000, "protein_g": protein / 2}),
                        origin,
                    ),
                )
    got = trophies(client, headers)
    assert got["food_streak_7"]["earned_on"] == (FIRST + timedelta(days=6)).isoformat()
    # days 0, 1, 2, 4 and 5 hit protein (3 and 7 miss): the fifth hit is day 5
    assert got["protein_5_of_7"]["earned_on"] == (FIRST + timedelta(days=5)).isoformat()
    assert got["calories_5_of_7"]["earned_on"] == (FIRST + timedelta(days=4)).isoformat()
    assert got["photo_logs_10"]["progress"] == 8
    assert got["entries_100"]["progress"] == 16


def test_goal_trophies_follow_the_trend(client, headers, user, db, profile) -> None:
    seed_weights(db, user, 90, 85.0, -0.05)  # trend falls from 85 to about 80.9
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into goals (user_id, metric, start_value, target_value, start_date)"
            " values (%s, 'weight_kg', 85, 83, %s)",
            (user, FIRST),
        )
        conn.execute(
            "insert into goals (user_id, metric, start_value, target_value, start_date, status)"
            " values (%s, 'waist_cm', 95, 90, %s, 'archived')",
            (user, FIRST),
        )
    got = trophies(client, headers)
    assert got["goal_halfway"]["earned_on"] is not None
    reached = got["goal_reached_1"]["earned_on"]
    assert reached is not None and reached > got["goal_halfway"]["earned_on"]
    assert got["goal_reached_3"]["progress"] == 1


def test_marked_achieved_goal_counts(client, headers, user, db, profile) -> None:
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into goals (user_id, metric, start_value, target_value, start_date, status)"
            " values (%s, 'body_fat_pct', 20, 15, %s, 'achieved')",
            (user, FIRST),
        )
    assert trophies(client, headers)["goal_reached_1"]["earned_on"] is not None


def test_hidden_metrics_hide_their_trophies(client, headers, profile) -> None:
    body = {**PROFILE, "hidden_metrics": ["body_fat_pct"]}
    assert client.put("/me/profile", json=body, headers=headers).status_code == 200
    got = trophies(client, headers)
    assert {"body_fat_down_2", "body_fat_down_5", "muscle_keeper"}.isdisjoint(got)
    assert "weight_down_1" in got and "waist_down_3" in got


def test_trophies_are_private(client, headers, user, db, make_user, profile) -> None:
    seed_weights(db, user, 1, 80, 0)
    assert trophies(client, headers)["first_weigh_in"]["earned_on"]
    other = auth_for(make_user())
    client.put("/me/profile", json=PROFILE, headers=other)
    assert trophies(client, other)["first_weigh_in"]["earned_on"] is None
    client.post("/achievements/seen", json={"keys": ["first_weigh_in"]}, headers=other)
    assert trophies(client, headers)["first_weigh_in"]["new"] is True


def test_seen_validates(client, headers, profile) -> None:
    assert client.post("/achievements/seen", json={"keys": []}, headers=headers).status_code == 422


def test_achievements_table_is_private(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into achievements (user_id, key, earned_on) values (%s, 'x', '2026-01-01')",
            (a,),
        )
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(b),))
        assert conn.execute("select * from achievements").fetchall() == []


@pytest.mark.parametrize(("lean_kept", "earned"), [(True, True), (False, False)])
def test_muscle_keeper(client, headers, user, db, profile, lean_kept, earned) -> None:
    with psycopg.connect(db) as conn:
        for i in range(60):
            weight = 85.0 - 0.1 * i
            # lean mass fixed at 65 kg, or body fat fixed at 20% (lean falls with weight)
            bf = (1 - 65 / weight) * 100 if lean_kept else 20.0
            conn.execute(
                "insert into body_entries (user_id, measured_at, weight_kg, body_fat_pct)"
                " values (%s, %s, %s, %s)",
                (user, at(FIRST + timedelta(days=i)), weight, round(bf, 1)),
            )
    got = trophies(client, headers)["muscle_keeper"]
    assert (got["earned_on"] is not None) is earned
