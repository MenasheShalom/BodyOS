import uuid

import psycopg
import pytest
from psycopg.types.json import Jsonb

KCAL = Jsonb({"energy_kcal": 100})


def _as_user(conn: psycopg.Connection, user_id: uuid.UUID) -> None:
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))


def _shared_food(conn: psycopg.Connection, ref: str = "123") -> uuid.UUID:
    row = conn.execute(
        "insert into foods (source, source_ref, name, nutrients_per_100g)"
        " values ('off', %s, 'Hummus', %s) returning id",
        (ref, KCAL),
    ).fetchone()
    assert row is not None
    return row[0]


def _custom_food(conn: psycopg.Connection, user_id: uuid.UUID) -> uuid.UUID:
    row = conn.execute(
        "insert into foods (user_id, source, name, nutrients_per_100g)"
        " values (%s, 'custom', 'Shake', %s) returning id",
        (user_id, KCAL),
    ).fetchone()
    assert row is not None
    return row[0]


def test_shared_food_readable_by_any_user_not_writable(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn:
        food_id = _shared_food(conn)
        _as_user(conn, a)
        assert conn.execute("select id from foods").fetchall() == [(food_id,)]
        cur = conn.execute("update foods set name = 'x' where id = %s", (food_id,))
        assert cur.rowcount == 0
        cur = conn.execute("delete from foods where id = %s", (food_id,))
        assert cur.rowcount == 0


def test_custom_food_visible_only_to_owner(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        _custom_food(conn, a)
        _as_user(conn, b)
        assert conn.execute("select id from foods").fetchall() == []


def test_user_cannot_insert_shared_food(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        _as_user(conn, a)
        _shared_food(conn)


def test_shared_food_must_be_external(db) -> None:
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into foods (source, name, nutrients_per_100g) values ('custom', 'x', %s)",
            (KCAL,),
        )


def test_external_ref_unique_for_shared_rows(db) -> None:
    with psycopg.connect(db) as conn:
        _shared_food(conn, "42")
        with pytest.raises(psycopg.errors.UniqueViolation):
            _shared_food(conn, "42")


def test_food_log_quick_add_needs_no_grams_but_food_entry_does(db, make_user) -> None:
    a = make_user()
    sql = (
        "insert into food_log (user_id, eaten_at, meal, food_id, name, grams, nutrients)"
        " values (%s, now(), 'lunch', %s, 'x', %s, %s)"
    )
    with psycopg.connect(db) as conn:
        food_id = _custom_food(conn, a)
        conn.execute(sql, (a, None, None, KCAL))
        conn.execute(sql, (a, food_id, 50, KCAL))
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(sql, (a, food_id, None, KCAL))


def test_food_log_nutrients_require_energy(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into food_log (user_id, eaten_at, meal, name, nutrients)"
            " values (%s, now(), 'lunch', 'x', %s)",
            (a, Jsonb({"protein_g": 5})),
        )


def test_food_delete_sets_log_food_null(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn:
        food_id = _custom_food(conn, a)
        conn.execute(
            "insert into food_log (user_id, eaten_at, meal, food_id, name, grams, nutrients)"
            " values (%s, now(), 'lunch', %s, 'Shake', 30, %s)",
            (a, food_id, KCAL),
        )
        conn.execute("delete from foods where id = %s", (food_id,))
        row = conn.execute("select food_id, name from food_log").fetchone()
    assert row == (None, "Shake")


def test_food_log_hidden_from_other_users(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into food_log (user_id, eaten_at, meal, name, nutrients)"
            " values (%s, now(), 'lunch', 'x', %s)",
            (a, KCAL),
        )
        _as_user(conn, b)
        assert conn.execute("select id from food_log").fetchall() == []


def test_targets_unique_per_day(db, make_user) -> None:
    a = make_user()
    sql = (
        "insert into nutrition_targets (user_id, effective_from, energy_kcal, protein_g,"
        " carbs_g, fat_g, fiber_g, origin) values (%s, current_date, 2300, 170, 250, 70, 30,"
        " 'manual')"
    )
    with psycopg.connect(db) as conn:
        conn.execute(sql, (a,))
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute(sql, (a,))


@pytest.mark.parametrize(
    ("column", "value"),
    [("deficit_pct", 30), ("protein_g_per_kg", 3.5), ("check_in_weekday", 7)],
)
def test_settings_ranges(db, make_user, column: str, value: float) -> None:
    a = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            f"insert into nutrition_settings (user_id, {column}) values (%s, %s)", (a, value)
        )


def test_settings_defaults(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn:
        row = conn.execute(
            "insert into nutrition_settings (user_id) values (%s)"
            " returning mode, deficit_pct, protein_g_per_kg, check_in_weekday, food_country",
            (a,),
        ).fetchone()
    assert row is not None
    assert (row[0], row[1], float(row[2]), row[3], row[4]) == (
        "recomp",
        None,
        2.0,
        6,
        "en:israel",
    )


# --- Phase 2: favourites, recipes, saved meals ------------------------------------------


def _recipe(conn: psycopg.Connection, user_id: uuid.UUID) -> uuid.UUID:
    row = conn.execute(
        "insert into recipes (user_id, name, servings) values (%s, 'Stew', 4) returning id",
        (user_id,),
    ).fetchone()
    assert row is not None
    return row[0]


def test_favourites_hidden_from_other_users(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        food_id = _shared_food(conn)
        conn.execute("insert into food_favourites (user_id, food_id) values (%s, %s)", (a, food_id))
        _as_user(conn, b)
        assert conn.execute("select * from food_favourites").fetchall() == []


def test_saved_meal_item_needs_food_or_nutrients(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn:
        meal = conn.execute(
            "insert into saved_meals (user_id, name) values (%s, 'Breakfast') returning id", (a,)
        ).fetchone()
        assert meal is not None
        food_id = _custom_food(conn, a)
        sql = (
            "insert into saved_meal_items (saved_meal_id, user_id, food_id, name, grams, nutrients)"
            " values (%s, %s, %s, 'x', %s, %s)"
        )
        conn.execute(sql, (meal[0], a, food_id, 30, None))
        conn.execute(sql, (meal[0], a, None, None, KCAL))
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(sql, (meal[0], a, food_id, 30, KCAL))


def test_recipe_food_needs_recipe_id(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn:
        recipe_id = _recipe(conn, a)
        conn.execute(
            "insert into foods (user_id, source, name, nutrients_per_100g, recipe_id)"
            " values (%s, 'recipe', 'Stew', %s, %s)",
            (a, KCAL, recipe_id),
        )
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "insert into foods (user_id, source, name, nutrients_per_100g)"
                " values (%s, 'recipe', 'Stew', %s)",
                (a, KCAL),
            )


def test_food_used_in_recipe_cannot_be_hard_deleted(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn:
        recipe_id = _recipe(conn, a)
        food_id = _custom_food(conn, a)
        conn.execute(
            "insert into recipe_items (recipe_id, user_id, food_id, grams) values (%s, %s, %s, 50)",
            (recipe_id, a, food_id),
        )
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            conn.execute("delete from foods where id = %s", (food_id,))


def test_deleting_recipe_removes_its_food(db, make_user) -> None:
    a = make_user()
    with psycopg.connect(db) as conn:
        recipe_id = _recipe(conn, a)
        conn.execute(
            "insert into foods (user_id, source, name, nutrients_per_100g, recipe_id)"
            " values (%s, 'recipe', 'Stew', %s, %s)",
            (a, KCAL, recipe_id),
        )
        conn.execute("delete from recipes where id = %s", (recipe_id,))
        assert conn.execute("select count(*) from foods").fetchone() == (0,)
