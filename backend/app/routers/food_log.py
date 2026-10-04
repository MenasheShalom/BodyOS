import uuid
from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from psycopg.types.json import Jsonb

from app.auth import current_user_id
from app.calculations.nutrition import day_bounds, scale, scale_snapshot
from app.clock import get_now
from app.crud import delete_row, get_row, require
from app.db import Conn, get_conn
from app.nutrition_schemas import (
    BatchFoodIn,
    BatchLogIn,
    CopyIn,
    DayFlagIn,
    FoodDayOut,
    FoodDaySummaryOut,
    FoodLogIn,
    FoodLogOut,
    FoodLogPatch,
    QuickAddIn,
)
from app.profiles import load_profile
from app.routers.body_entries import check_not_future
from app.services.food_log_service import LOG_COLUMNS, entries_between, food_day
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


def _food_values(conn: Conn, user_id: UUID, body: FoodLogIn, now: datetime) -> dict[str, Any]:
    check_not_future("eaten_at", body.eaten_at, now)
    food = visible_food(conn, user_id, body.food_id)
    if food is None:
        raise HTTPException(status_code=404, detail="Food not found")
    return {
        "eaten_at": body.eaten_at,
        "meal": body.meal,
        "food_id": body.food_id,
        "name": food["name"],
        "grams": body.grams,
        "serving_label": body.serving_label,
        "serving_count": body.serving_count,
        "nutrients": Jsonb(scale(food["nutrients_per_100g"], body.grams)),
    }


def _quick_values(body: QuickAddIn, now: datetime) -> dict[str, Any]:
    check_not_future("eaten_at", body.eaten_at, now)
    return {
        "eaten_at": body.eaten_at,
        "meal": body.meal,
        "name": body.name,
        "nutrients": Jsonb(body.nutrients),
    }


@router.post("", response_model=FoodLogOut, status_code=201)
def log_food(
    body: FoodLogIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    return _insert(conn, user_id, _food_values(conn, user_id, body, now))


@router.post("/quick", response_model=FoodLogOut, status_code=201)
def quick_add(
    body: QuickAddIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    return _insert(conn, user_id, _quick_values(body, now))


@router.post("/batch", response_model=list[FoodLogOut], status_code=201)
def log_batch(
    body: BatchLogIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> list[dict[str, Any]]:
    """Several entries in one transaction, e.g. the items read from a food photo. Any invalid
    entry fails the whole request."""
    values = [
        {
            **(
                _food_values(conn, user_id, e, now)
                if isinstance(e, BatchFoodIn)
                else _quick_values(e, now)
            ),
            "origin": e.origin,
        }
        for e in body.entries
    ]
    return [_insert(conn, user_id, v) for v in values]


MAX_DAYS_LISTED = 92


@router.get("/days", response_model=list[FoodDaySummaryOut])
def list_days(
    start: date = Query(alias="from"),
    end: date = Query(alias="to"),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[FoodDaySummaryOut]:
    """Per-day totals for days with entries, newest first (for History)."""
    if end < start or (end - start).days > MAX_DAYS_LISTED:
        raise HTTPException(status_code=422, detail=f"Choose up to {MAX_DAYS_LISTED} days")
    profile = load_profile(conn, user_id)
    tz = profile.tz if profile else UTC_ZONE
    first, _ = day_bounds(start, tz)
    _, last = day_bounds(end, tz)
    rows = conn.execute(
        "select eaten_at, nutrients from food_log"
        " where user_id = %s and eaten_at >= %s and eaten_at < %s",
        (user_id, first, last),
    ).fetchall()
    flags = {
        r["day"]
        for r in conn.execute(
            "select day from nutrition_day_flags where user_id = %s and excluded"
            " and day between %s and %s",
            (user_id, start, end),
        ).fetchall()
    }
    days: dict[date, list[dict[str, float]]] = {}
    for r in rows:
        days.setdefault(r["eaten_at"].astimezone(tz).date(), []).append(r["nutrients"])
    return [
        FoodDaySummaryOut(
            day=d,
            energy_kcal=round(sum(n.get("energy_kcal", 0.0) for n in items), 1),
            protein_g=round(sum(n.get("protein_g", 0.0) for n in items), 1),
            entries=len(items),
            excluded=d in flags,
        )
        for d, items in sorted(days.items(), reverse=True)
    ]


@router.put("/days/{day}/flag", status_code=204)
def flag_day(
    day: date,
    body: DayFlagIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    """Mark a day incomplete (left out of the TDEE and averages), or complete again."""
    if body.excluded:
        conn.execute(
            "insert into nutrition_day_flags (user_id, day, excluded) values (%s, %s, true)"
            " on conflict (user_id, day) do update set excluded = true",
            (user_id, day),
        )
    else:
        conn.execute(
            "delete from nutrition_day_flags where user_id = %s and day = %s", (user_id, day)
        )
    return Response(status_code=204)


@router.post("/copy", response_model=list[FoodLogOut], status_code=201)
def copy_entries(
    body: CopyIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> list[dict[str, Any]]:
    """Copy a day's entries (or one meal's) to another day at the same local times."""
    profile = load_profile(conn, user_id)
    tz = profile.tz if profile else UTC_ZONE
    if body.to_day > local_today(now, profile):
        raise HTTPException(status_code=422, detail="Can't copy into a future day")
    rows = [
        r
        for r in entries_between(conn, user_id, body.from_day, tz)
        if body.meal is None or r["meal"] == body.meal
    ]
    meal_ref = uuid.uuid4()  # groups the copies so they can be undone together later
    copies = []
    for r in rows:
        local_time = r["eaten_at"].astimezone(tz).time()
        eaten_at = datetime.combine(body.to_day, local_time, tzinfo=tz)
        copies.append(
            _insert(
                conn,
                user_id,
                {
                    "eaten_at": min(eaten_at, now),
                    "meal": body.to_meal or r["meal"],
                    "food_id": r["food_id"],
                    "name": r["name"],
                    "grams": r["grams"],
                    "serving_label": r["serving_label"],
                    "serving_count": r["serving_count"],
                    "nutrients": Jsonb(r["nutrients"]),
                    "meal_ref": meal_ref,
                    "origin": r["origin"],  # a copied estimate is still an estimate
                },
            )
        )
    return copies


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
