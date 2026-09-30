import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg.types.json import Jsonb

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.nutrition_schemas import (
    FoodLogOut,
    SavedMealFromLogIn,
    SavedMealIn,
    SavedMealLogIn,
    SavedMealOut,
)
from app.profiles import load_profile
from app.routers.body_entries import check_not_future
from app.services.food_log_service import LOG_COLUMNS, entries_between
from app.services.saved_meal_service import (
    get_meal,
    items_from_log,
    meal_items,
    meal_out,
    save_meal,
)
from app.services.series_service import UTC_ZONE

router = APIRouter(prefix="/saved-meals", tags=["saved meals"])


@router.get("", response_model=list[SavedMealOut])
def list_meals(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[SavedMealOut]:
    rows = conn.execute(
        "select id, name from saved_meals where user_id = %s order by lower(name)", (user_id,)
    ).fetchall()
    return [meal_out(conn, r) for r in rows]


@router.post("", response_model=SavedMealOut, status_code=201)
def create_meal(
    body: SavedMealIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> SavedMealOut:
    return save_meal(conn, user_id, body)


@router.post("/from-log", response_model=SavedMealOut, status_code=201)
def create_from_log(
    body: SavedMealFromLogIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> SavedMealOut:
    """Save what was logged for one meal of a day as a reusable meal."""
    profile = load_profile(conn, user_id)
    tz = profile.tz if profile else UTC_ZONE
    entries = [e for e in entries_between(conn, user_id, body.day, tz) if e["meal"] == body.meal]
    if not entries:
        raise HTTPException(status_code=422, detail="Nothing logged for that meal")
    return save_meal(conn, user_id, SavedMealIn(name=body.name, items=items_from_log(entries)))


@router.put("/{meal_id}", response_model=SavedMealOut)
def update_meal(
    meal_id: UUID,
    body: SavedMealIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> SavedMealOut:
    return save_meal(conn, user_id, body, meal_id)


@router.delete("/{meal_id}", status_code=204)
def delete_meal(
    meal_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    row = conn.execute(
        "delete from saved_meals where id = %s and user_id = %s returning id", (meal_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)


@router.post("/{meal_id}/log", response_model=list[FoodLogOut], status_code=201)
def log_meal(
    meal_id: UUID,
    body: SavedMealLogIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> list[dict[str, Any]]:
    """Log every item of a saved meal as its own entry, grouped by a shared meal_ref."""
    check_not_future("eaten_at", body.eaten_at, now)
    if get_meal(conn, user_id, meal_id) is None:
        raise HTTPException(status_code=404, detail="Not found")
    meal_ref = uuid.uuid4()
    entries = []
    for item in meal_items(conn, meal_id):
        row = conn.execute(
            "insert into food_log (user_id, eaten_at, meal, food_id, name, grams, serving_label,"
            " serving_count, nutrients, meal_ref) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
            f" returning {LOG_COLUMNS}",
            (
                user_id,
                body.eaten_at,
                body.meal,
                item["food_id"],
                item["name"],
                item["grams"],
                item["serving_label"],
                item["serving_count"],
                Jsonb(item["nutrients"]),
                meal_ref,
            ),
        ).fetchone()
        assert row is not None
        entries.append(row)
    return entries
