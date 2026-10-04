from datetime import date
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from app.calculations.nutrition import day_bounds, day_totals
from app.db import Conn
from app.nutrition_schemas import FoodDayOut, FoodLogOut, TargetsOut

LOG_COLUMNS = (
    "id, eaten_at, meal, food_id, name, grams, serving_label, serving_count, nutrients, meal_ref"
)
TARGET_COLUMNS = (
    "effective_from, energy_kcal, protein_g, carbs_g, fat_g, fiber_g, origin, tdee_at_creation"
)


def target_on(conn: Conn, user_id: UUID, day: date) -> dict[str, Any] | None:
    """The targets in force on `day`: the latest row that started on or before it."""
    return conn.execute(
        f"select {TARGET_COLUMNS} from nutrition_targets"
        " where user_id = %s and effective_from <= %s order by effective_from desc limit 1",
        (user_id, day),
    ).fetchone()


def entries_between(conn: Conn, user_id: UUID, day: date, tz: ZoneInfo) -> list[dict[str, Any]]:
    start, end = day_bounds(day, tz)
    return conn.execute(
        f"select {LOG_COLUMNS} from food_log"
        " where user_id = %s and eaten_at >= %s and eaten_at < %s order by eaten_at, created_at",
        (user_id, start, end),
    ).fetchall()


def food_day(conn: Conn, user_id: UUID, day: date, tz: ZoneInfo) -> FoodDayOut:
    rows = entries_between(conn, user_id, day, tz)
    totals = day_totals(r["nutrients"] for r in rows)
    target = target_on(conn, user_id, day)
    flag = conn.execute(
        "select excluded from nutrition_day_flags where user_id = %s and day = %s", (user_id, day)
    ).fetchone()
    return FoodDayOut(
        day=day,
        entries=[FoodLogOut.model_validate(r) for r in rows],
        totals={k: round(v, 2) for k, v in totals.totals.items()},
        coverage={k: round(v, 3) for k, v in totals.coverage.items()},
        target=TargetsOut.model_validate(target) if target else None,
        excluded=bool(flag and flag["excluded"]),
    )
