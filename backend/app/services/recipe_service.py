from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.calculations.nutrition import recipe_totals, scale
from app.db import Conn
from app.nutrition_schemas import RecipeIn, RecipeItemOut, RecipeOut
from app.services.food_service import food_in_use, visible_food

RECIPE_COLUMNS = "id, name, servings, cooked_weight_g, note, instructions"


def _ingredients(conn: Conn, user_id: UUID, body: RecipeIn) -> list[dict[str, Any]]:
    foods = []
    for item in body.items:
        food = visible_food(conn, user_id, item.food_id)
        if food is None:
            raise HTTPException(status_code=404, detail="Ingredient not found")
        if food["source"] == "recipe":
            raise HTTPException(status_code=422, detail="Recipes can't contain other recipes yet")
        foods.append(food)
    return foods


def get_recipe(conn: Conn, user_id: UUID, recipe_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        f"select {RECIPE_COLUMNS} from recipes where id = %s and user_id = %s and not archived",
        (recipe_id, user_id),
    ).fetchone()


def recipe_out(conn: Conn, recipe: dict[str, Any]) -> RecipeOut:
    rows = conn.execute(
        "select i.food_id, i.grams, f.name, f.brand, f.nutrients_per_100g"
        " from recipe_items i join foods f on f.id = i.food_id"
        " where i.recipe_id = %s order by i.position",
        (recipe["id"],),
    ).fetchall()
    food = conn.execute("select id from foods where recipe_id = %s", (recipe["id"],)).fetchone()
    assert food is not None
    cooked = float(recipe["cooked_weight_g"]) if recipe["cooked_weight_g"] else None
    totals = recipe_totals([(r["nutrients_per_100g"], float(r["grams"])) for r in rows], cooked)
    servings = float(recipe["servings"])
    return RecipeOut(
        id=recipe["id"],
        name=recipe["name"],
        servings=servings,
        cooked_weight_g=cooked,
        note=recipe["note"],
        instructions=recipe["instructions"],
        food_id=food["id"],
        items=[
            RecipeItemOut(
                food_id=r["food_id"],
                name=r["name"],
                brand=r["brand"],
                grams=float(r["grams"]),
                nutrients={
                    k: round(v, 1)
                    for k, v in scale(r["nutrients_per_100g"], float(r["grams"])).items()
                },
            )
            for r in rows
        ],
        total_grams=round(totals.weight_g, 1),
        serving_grams=round(totals.weight_g / servings, 1),
        per_serving={k: round(v / servings, 1) for k, v in totals.total.items()},
        incomplete_nutrients=totals.incomplete,
    )


def save_recipe(
    conn: Conn, user_id: UUID, body: RecipeIn, recipe_id: UUID | None = None
) -> RecipeOut:
    """Create or replace a recipe and refresh the food it is logged through."""
    foods = _ingredients(conn, user_id, body)
    values = (body.name, body.servings, body.cooked_weight_g, body.note, body.instructions)
    if recipe_id is None:
        row = conn.execute(
            "insert into recipes (user_id, name, servings, cooked_weight_g, note, instructions)"
            f" values (%s, %s, %s, %s, %s, %s) returning {RECIPE_COLUMNS}",
            (user_id, *values),
        ).fetchone()
    else:
        row = conn.execute(
            "update recipes set name = %s, servings = %s, cooked_weight_g = %s, note = %s,"
            f" instructions = %s where id = %s and user_id = %s and not archived returning {RECIPE_COLUMNS}",
            (*values, recipe_id, user_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        conn.execute("delete from recipe_items where recipe_id = %s", (recipe_id,))
    assert row is not None
    for position, (item, food) in enumerate(zip(body.items, foods, strict=True)):
        conn.execute(
            "insert into recipe_items (recipe_id, user_id, food_id, grams, position)"
            " values (%s, %s, %s, %s, %s)",
            (row["id"], user_id, food["id"], item.grams, position),
        )

    totals = recipe_totals(
        [(f["nutrients_per_100g"], i.grams) for i, f in zip(body.items, foods, strict=True)],
        body.cooked_weight_g,
    )
    per_100g = {k: round(v, 3) for k, v in totals.per_100g.items()}
    servings = [{"label": "1 serving", "grams": round(totals.weight_g / body.servings, 1)}]
    conn.execute(
        """
        insert into foods (user_id, source, name, nutrients_per_100g, servings, recipe_id)
        values (%s, 'recipe', %s, %s, %s, %s)
        on conflict (recipe_id) where recipe_id is not null do update set
          name = excluded.name,
          nutrients_per_100g = excluded.nutrients_per_100g,
          servings = excluded.servings
        """,
        (user_id, body.name, Jsonb(per_100g), Jsonb(servings), row["id"]),
    )
    return recipe_out(conn, row)


def delete_recipe(conn: Conn, user_id: UUID, recipe_id: UUID) -> bool:
    if get_recipe(conn, user_id, recipe_id) is None:
        return False
    food = conn.execute("select id from foods where recipe_id = %s", (recipe_id,)).fetchone()
    if food is not None and food_in_use(conn, food["id"]):
        # logged days (or saved meals) still point at it; hide it instead
        conn.execute("update recipes set archived = true where id = %s", (recipe_id,))
        conn.execute("update foods set archived = true where id = %s", (food["id"],))
    else:
        conn.execute("delete from recipes where id = %s", (recipe_id,))  # cascades to its food
    return True
