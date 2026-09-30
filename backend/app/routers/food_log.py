from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg.types.json import Jsonb

from app.auth import current_user_id
from app.calculations.nutrition import scale, scale_snapshot
from app.clock import get_now
from app.crud import delete_row, get_row, require
from app.db import Conn, get_conn
from app.nutrition_schemas import FoodDayOut, FoodLogIn, FoodLogOut, FoodLogPatch, QuickAddIn
from app.profiles import load_profile
from app.routers.body_entries import check_not_future
from app.services.food_log_service import LOG_COLUMNS, food_day
from app.services.food_service import visible_food
from app.services.series_service import UTC_ZONE, local_today

router = APIRouter(prefix="/food-log", tags=["food log"])


@router.get("", response_model=FoodDayOut)
def get_day(
    day: date | None = None,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> FoodDayOut:
    profile = load_profile(conn, user_id)
    tz = profile.tz if profile else UTC_ZONE
    return food_day(conn, user_id, day or local_today(now, profile), tz)


def _insert(conn: Conn, user_id: UUID, values: dict[str, Any]) -> dict[str, Any]:
    cols = ", ".join(values)
    marks = ", ".join(["%s"] * len(values))
    row = conn.execute(
        f"insert into food_log (user_id, {cols}) values (%s, {marks}) returning {LOG_COLUMNS}",
        (user_id, *values.values()),
    ).fetchone()
    assert row is not None
    return row


@router.post("", response_model=FoodLogOut, status_code=201)
def log_food(
    body: FoodLogIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("eaten_at", body.eaten_at, now)
    food = visible_food(conn, user_id, body.food_id)
    if food is None:
        raise HTTPException(status_code=404, detail="Food not found")
    return _insert(
        conn,
        user_id,
        {
            "eaten_at": body.eaten_at,
            "meal": body.meal,
            "food_id": body.food_id,
            "name": food["name"],
            "grams": body.grams,
            "serving_label": body.serving_label,
            "serving_count": body.serving_count,
            "nutrients": Jsonb(scale(food["nutrients_per_100g"], body.grams)),
        },
    )


@router.post("/quick", response_model=FoodLogOut, status_code=201)
def quick_add(
    body: QuickAddIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("eaten_at", body.eaten_at, now)
    return _insert(
        conn,
        user_id,
        {
            "eaten_at": body.eaten_at,
            "meal": body.meal,
            "name": body.name,
            "nutrients": Jsonb(body.nutrients),
        },
    )


@router.patch("/{entry_id}", response_model=FoodLogOut)
def update_entry(
    entry_id: UUID,
    body: FoodLogPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    entry = require(get_row(conn, "food_log", user_id, entry_id))
    check_not_future("eaten_at", body.eaten_at, now)
    data = body.model_dump(exclude_unset=True)
    from_food = entry["grams"] is not None
    if from_food and "nutrients" in data:
        raise HTTPException(status_code=422, detail="Change the amount instead")
    if not from_food and {"grams", "serving_label", "serving_count"} & data.keys():
        raise HTTPException(status_code=422, detail="Quick add entries have no amount")
    if "grams" in data:
        old = float(entry["grams"])
        data["nutrients"] = scale_snapshot(entry["nutrients"], old, data["grams"])
    if "nutrients" in data:
        data["nutrients"] = Jsonb(data["nutrients"])
    if not data:
        return entry
    assignments = ", ".join(f"{col} = %s" for col in data)
    row = conn.execute(
        f"update food_log set {assignments} where id = %s and user_id = %s returning {LOG_COLUMNS}",
        (*data.values(), entry_id, user_id),
    ).fetchone()
    return require(row)


@router.delete("/{entry_id}", status_code=204)
def delete_entry(
    entry_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    if not delete_row(conn, "food_log", user_id, entry_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
