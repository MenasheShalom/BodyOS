from decimal import Decimal

import psycopg
import pytest


def test_weight_out_of_range_rejected(db, make_user) -> None:
    uid = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into body_entries (user_id, measured_at, weight_kg) values (%s, now(), 800)",
            (uid,),
        )


def test_measurement_requires_at_least_one_value(db, make_user) -> None:
    uid = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("insert into measurements (user_id, measured_at) values (%s, now())", (uid,))


def test_one_active_goal_per_metric(db, make_user) -> None:
    uid = make_user()
    sql = (
        "insert into goals (user_id, metric, start_value, target_value, start_date, status)"
        " values (%s, 'body_fat_pct', 20, 15, current_date, %s)"
    )
    with psycopg.connect(db) as conn:
        conn.execute(sql, (uid, "active"))
        conn.execute(sql, (uid, "archived"))  # archived duplicates are fine
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute(sql, (uid, "active"))


def test_rls_hides_other_users_rows(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into body_entries (user_id, measured_at, weight_kg)"
            " values (%s, now(), 80), (%s, now(), 90)",
            (a, b),
        )
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(a),))
        rows = conn.execute("select weight_kg from body_entries").fetchall()
    assert [r[0] for r in rows] == [Decimal("80.00")]


def test_updated_at_trigger(db, make_user) -> None:
    uid = make_user()
    with psycopg.connect(db, autocommit=True) as conn:
        row = conn.execute(
            "insert into body_entries (user_id, measured_at, weight_kg, updated_at)"
            " values (%s, now(), 80, now() - interval '1 day') returning id, updated_at",
            (uid,),
        ).fetchone()
        assert row is not None
        after = conn.execute(
            "update body_entries set weight_kg = 81 where id = %s returning updated_at", (row[0],)
        ).fetchone()
    assert after is not None and after[0] > row[1]


def test_photo_bucket_is_private(db) -> None:
    with psycopg.connect(db) as conn:
        row = conn.execute(
            "select public from storage.buckets where id = 'progress-photos'"
        ).fetchone()
    assert row == (False,)
