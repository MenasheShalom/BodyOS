"""Meal plans and recipes from groceries (spec §5.4). Nothing here is saved or logged: the
user reviews the result and saves or logs it through the ordinary endpoints."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.ai.factory import get_provider
from app.ai.prompts import meal_plan, recipes_from_groceries
from app.ai.prompts.meal_plan import Ingredient
from app.ai.provider import AIProvider, AIRequest
from app.ai.service import run
from app.ai_schemas import (
    GroceriesIn,
    MealPlanIn,
    MealPlanResultOut,
    PlannedMealOut,
    PlanTargetsOut,
    RecipeIdeaOut,
    RecipeIdeasOut,
    ResolvedIngredientOut,
    grocery_list,
)
from app.auth import current_user_id
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import Conn, get_conn
from app.food_sources import FoodSource, get_food_sources
from app.nutrition_schemas import FoodOut
from app.profiles import load_profile
from app.services.food_log_service import food_day
from app.services.ingredient_resolver import add_up, nutrients_for, resolve
from app.services.series_service import UTC_ZONE

router = APIRouter(prefix="/ai", tags=["ai"])

MACROS = ("energy_kcal", "protein_g", "carbs_g", "fat_g")
MIN_KCAL_LEFT = 200


def _resolved(
    ingredients: list[Ingredient], foods: dict[str, FoodOut]
) -> list[ResolvedIngredientOut]:
    out = []
    for i in ingredients:
        food = foods.get(i.search_query)
        grams = round(i.grams)
        out.append(
            ResolvedIngredientOut(
                name=i.name,
                search_query=i.search_query,
                grams=grams,
                food=food,
                nutrients=nutrients_for(food, grams) if food else {},
            )
        )
    return out


@router.post("/meal-plan", response_model=MealPlanResultOut)
def plan_meals(
    body: MealPlanIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    provider: AIProvider | None = Depends(get_provider),
    sources: dict[str, FoodSource] = Depends(get_food_sources),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> MealPlanResultOut:
    profile = load_profile(conn, user_id)
    tz = profile.tz if profile else UTC_ZONE
    day = food_day(conn, user_id, now.astimezone(tz).date(), tz)
    if day.target is None:
        raise HTTPException(status_code=409, detail="Set your nutrition targets first")
    targets = {k: float(getattr(day.target, k)) for k in MACROS}
    if body.rest_of_today:
        targets = {k: max(v - day.totals.get(k, 0.0), 0.0) for k, v in targets.items()}
        if targets["energy_kcal"] < MIN_KCAL_LEFT:
            raise HTTPException(
                status_code=422, detail="There's not much left of today's targets to plan"
            )

    # Remembered whatever the outcome, so the user needn't type them again.
    conn.execute(
        "insert into ai_settings (user_id, plan_preferences) values (%s, %s)"
        " on conflict (user_id) do update set plan_preferences = excluded.plan_preferences",
        (user_id, body.preferences),
    )
    result = run(
        conn,
        user_id,
        provider,
        AIRequest(
            feature="meal_plan",
            prompt_version=meal_plan.PROMPT_VERSION,
            system=meal_plan.SYSTEM,
            text=meal_plan.user_text(
                meals=body.meals,
                rest_of_today=body.rest_of_today,
                preferences=body.preferences,
                **targets,
            ),
            schema=meal_plan.MealPlanOut,
        ),
        now=now,
        tz=tz,
        limit=settings.ai_monthly_request_limit,
    )
    plan = result.value
    foods = resolve(
        conn,
        user_id,
        sources,
        [i.search_query for m in plan.meals for i in m.ingredients],
    )
    meals = []
    for m in plan.meals:
        ingredients = _resolved(m.ingredients, foods)
        meals.append(
            PlannedMealOut(
                meal=m.meal,
                title=m.title,
                ingredients=ingredients,
                totals=add_up([i.nutrients for i in ingredients]),
            )
        )
    return MealPlanResultOut(
        targets=PlanTargetsOut(**{k: round(v) for k, v in targets.items()}),
        rest_of_today=body.rest_of_today,
        meals=meals,
        totals=add_up([m.totals for m in meals]),
        unresolved=sum(i.food is None for m in meals for i in m.ingredients),
        notes=plan.notes,
    )


@router.post("/recipes-from-groceries", response_model=RecipeIdeasOut)
def recipes_from_groceries_ideas(
    body: GroceriesIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    provider: AIProvider | None = Depends(get_provider),
    sources: dict[str, FoodSource] = Depends(get_food_sources),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> RecipeIdeasOut:
    profile = load_profile(conn, user_id)
    result = run(
        conn,
        user_id,
        provider,
        AIRequest(
            feature="recipe_from_groceries",
            prompt_version=recipes_from_groceries.PROMPT_VERSION,
            system=recipes_from_groceries.SYSTEM,
            text=recipes_from_groceries.user_text(
                groceries=grocery_list(body.groceries),
                servings=body.servings,
                staples=body.staples,
            ),
            schema=recipes_from_groceries.RecipesOut,
        ),
        now=now,
        tz=profile.tz if profile else UTC_ZONE,
        limit=settings.ai_monthly_request_limit,
    )
    ideas = result.value
    foods = resolve(
        conn,
        user_id,
        sources,
        [i.search_query for r in ideas.recipes for i in r.ingredients],
    )
    recipes = []
    for r in ideas.recipes:
        ingredients = _resolved(r.ingredients, foods)
        totals = add_up([i.nutrients for i in ingredients])
        recipes.append(
            RecipeIdeaOut(
                name=r.name,
                servings=r.servings,
                minutes=r.minutes,
                ingredients=ingredients,
                steps=r.steps,
                totals=totals,
                per_serving={k: round(v / r.servings, 1) for k, v in totals.items()},
            )
        )
    return RecipeIdeasOut(
        recipes=recipes,
        unresolved=sum(i.food is None for r in recipes for i in r.ingredients),
        notes=ideas.notes,
    )
