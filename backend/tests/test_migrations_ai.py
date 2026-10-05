import uuid

import psycopg
import pytest
from psycopg.types.json import Jsonb


def _as_user(conn: psycopg.Connection, user_id: uuid.UUID) -> None:
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))


USAGE = (
    "insert into ai_usage (user_id, feature, provider, model, prompt_version, latency_ms, outcome)"
    " values (%s, 'food_photo', 'fake', 'fake-1', 'food-photo-1', 120, 'ok')"
)


def test_usage_private_and_append_only(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        _as_user(conn, a)
        conn.execute(USAGE, (a,))
        assert conn.execute("update ai_usage set outcome = 'refused'").rowcount == 0
        assert conn.execute("delete from ai_usage").rowcount == 0
        assert conn.execute("select count(*) from ai_usage").fetchone() == (1,)
    with psycopg.connect(db) as conn:
        conn.execute(USAGE, (a,))
        _as_user(conn, b)
        assert conn.execute("select * from ai_usage").fetchall() == []


def test_usage_rejects_unknown_feature(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(USAGE.replace("'food_photo'", "'chat'"), (a,))


def test_settings_private(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        conn.execute("insert into ai_settings (user_id) values (%s)", (a,))
        _as_user(conn, b)
        assert conn.execute("select * from ai_settings").fetchall() == []


def test_food_log_origin(db, make_user) -> None:
    a = make_user()
    sql = (
        "insert into food_log (user_id, eaten_at, meal, name, nutrients{col})"
        " values (%s, now(), 'lunch', 'x', %s{val}) returning origin"
    )
    kcal = Jsonb({"energy_kcal": 100})
    with psycopg.connect(db) as conn:
        row = conn.execute(sql.format(col="", val=""), (a, kcal)).fetchone()
        assert row == ("manual",)
        row = conn.execute(sql.format(col=", origin", val=", 'ai_photo'"), (a, kcal)).fetchone()
        assert row == ("ai_photo",)
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(sql.format(col=", origin", val=", 'robot'"), (a, kcal))


# --- Phase 2: reports and body-fat estimates ---------------------------------------------

REPORT = (
    "insert into ai_reports (user_id, week_start, facts, summary, sections, provider, model,"
    " prompt_version) values (%s, '2026-10-04', '{}', 'Good week', '[]', 'fake', 'm', 'v')"
)
ESTIMATE = (
    "insert into ai_body_fat_estimates (user_id, taken_on, photo_ids, low_pct, estimate_pct,"
    " high_pct, provider, model, prompt_version)"
    " values (%s, '2026-10-04', %s, %s, %s, %s, 'fake', 'm', 'v')"
)


def test_one_report_per_week_and_private(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        conn.execute(REPORT, (a,))
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute(REPORT, (a,))
    with psycopg.connect(db) as conn:
        _as_user(conn, b)
        assert conn.execute("select * from ai_reports").fetchall() == []


def test_body_fat_range_must_be_ordered(db, make_user) -> None:
    a = make_user()
    photo = [uuid.uuid4()]
    with psycopg.connect(db) as conn:
        conn.execute(ESTIMATE, (a, photo, 17, 19, 21))
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(ESTIMATE, (a, photo, 20, 19, 21))
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(ESTIMATE, (a, [], 17, 19, 21))


def test_planning_columns_are_bounded(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into ai_settings (user_id, plan_preferences) values (%s, %s)", (a, "x" * 501)
        )
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into recipes (user_id, name, servings, instructions) values (%s, 'r', 1, %s)",
            (a, "x" * 4001),
        )
