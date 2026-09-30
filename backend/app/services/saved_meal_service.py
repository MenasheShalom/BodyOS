from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.calculations.nutrition import day_totals, scale
from app.db import Conn
from app.nutrition_schemas import (
    QUICK_ADD_KEYS,
    SavedMealIn,
    SavedMealItemIn,
    SavedMealItemOut,
    SavedMealOut,
)
from app.services.food_service import visible_food

ITEM_COLUMNS = "food_id, name, grams, serving_label, serving_count, nutrients"


def get_meal(conn: Conn, user_id: UUID, meal_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        "select id, name from saved_meals where id = %s and user_id = %s", (meal_id, user_id)
    ).fetchone()


def meal_items(conn: Conn, meal_id: UUID) -> list[dict[str, Any]]:
    """Items with the nutrients they'd log now: food items scaled from the food's values."""
    rows = conn.execute(
        "select i.food_id, i.name, i.grams, i.serving_label, i.serving_count, i.nutrients,"
        " f.nutrients_per_100g from saved_meal_items i left join foods f on f.id = i.food_id"
        " where i.saved_meal_id = %s order by i.position",
        (meal_id,),
    ).fetchall()
    for r in rows:
        if r["food_id"] is not None:
            r["nutrients"] = scale(r["nutrients_per_100g"], float(r["grams"]))
    return rows


def meal_out(conn: Conn, meal: dict[str, Any]) -> SavedMealOut:
    items = meal_items(conn, meal["id"])
    totals = day_totals(r["nutrients"] for r in items).totals
    return SavedMealOut(
        id=meal["id"],
        name=meal["name"],
        items=[
            SavedMealItemOut(
                food_id=r["food_id"],
                name=r["name"],
                grams=r["grams"],
                serving_label=r["serving_label"],
                serving_count=r["serving_count"],
                nutrients={k: round(v, 1) for k, v in r["nutrients"].items()},
            )
            for r in items
        ],
        totals={k: round(v, 1) for k, v in totals.items()},
    )


def _insert_items(conn: Conn, user_id: UUID, meal_id: UUID, items: list[SavedMealItemIn]) -> None:
    for position, item in enumerate(items):
        if item.food_id is not None:
            food = visible_food(conn, user_id, item.food_id)
            if food is None:
                raise HTTPException(status_code=404, detail="Food not found")
            name, nutrients = food["name"], None
        else:
            name, nutrients = item.name or "Quick add", Jsonb(item.nutrients)
        conn.execute(
            "insert into saved_meal_items (saved_meal_id, user_id, food_id, name, grams,"
            " serving_label, serving_count, nutrients, position)"
            " values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                meal_id,
                user_id,
                item.food_id,
                name,
                item.grams,
                item.serving_label,
                item.serving_count,
                nutrients,
                position,
            ),
        )


def save_meal(
    conn: Conn, user_id: UUID, body: SavedMealIn, meal_id: UUID | None = None
) -> SavedMealOut:
    if meal_id is None:
        row = conn.execute(
            "insert into saved_meals (user_id, name) values (%s, %s) returning id, name",
            (user_id, body.name),
        ).fetchone()
    else:
        row = conn.execute(
            "update saved_meals set name = %s where id = %s and user_id = %s returning id, name",
            (body.name, meal_id, user_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        conn.execute("delete from saved_meal_items where saved_meal_id = %s", (meal_id,))
    assert row is not None
    _insert_items(conn, user_id, row["id"], body.items)
    return meal_out(conn, row)


def items_from_log(entries: list[dict[str, Any]]) -> list[SavedMealItemIn]:
    """Log entries as saved-meal items: foods by reference, quick adds by their numbers."""
    items = []
    for e in entries:
        if e["food_id"] is not None and e["grams"] is not None:
            items.append(
                SavedMealItemIn(
                    food_id=e["food_id"],
                    grams=float(e["grams"]),
                    serving_label=e["serving_label"],
                    serving_count=e["serving_count"],
                )
            )
        else:
            quick = {k: v for k, v in e["nutrients"].items() if k in QUICK_ADD_KEYS}
            items.append(SavedMealItemIn(name=e["name"], nutrients=quick))
    return items
