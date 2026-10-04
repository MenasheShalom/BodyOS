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
