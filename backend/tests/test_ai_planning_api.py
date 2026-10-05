from collections.abc import Iterator
from typing import Any

import psycopg
import pytest

from app.ai.prompts import meal_plan, recipes_from_groceries
from app.ai_schemas import grocery_list
from app.food_sources import get_food_sources
from app.food_sources.fake import FakeFoodSource, default_sources

PROFILE = {
    "height_cm": 180,
    "sex": "male",
    "date_of_birth": "1988-10-01",
    "timezone": "Asia/Jerusalem",
}
TARGETS = {
    "effective_from": "2026-02-01",
    "origin": "manual",
    "energy_kcal": 2000,
    "protein_g": 160,
    "carbs_g": 180,
    "fat_g": 70,
    "fiber_g": 30,
}
AT = "2026-03-01T09:00:00+02:00"  # FIXED_NOW is 14:00 in Jerusalem


@pytest.fixture
def sources(app_under_test: Any) -> Iterator[dict[str, FakeFoodSource]]:
    fakes = default_sources()
    app_under_test.dependency_overrides[get_food_sources] = lambda: fakes
    yield fakes


@pytest.fixture
def ready(client, headers, ai, sources) -> dict[str, FakeFoodSource]:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    assert client.post("/nutrition/targets", json=TARGETS, headers=headers).status_code == 201
    return sources


def plan(client, headers, **body: Any) -> Any:
    return client.post("/ai/meal-plan", json={"meals": 3, **body}, headers=headers)


def ingredients(body: dict[str, Any]) -> list[dict[str, Any]]:
    key = "meals" if "meals" in body else "recipes"
    return [i for m in body[key] for i in m["ingredients"]]


def test_plan_needs_targets(client, headers, ai, sources) -> None:
    res = plan(client, headers)
    assert res.status_code == 409
    assert res.json()["detail"] == "Set your nutrition targets first"


def test_plan_needs_ai(client, headers, sources) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    assert client.post("/nutrition/targets", json=TARGETS, headers=headers).status_code == 201
    assert plan(client, headers).json()["code"] == "ai_disabled"


def test_plan_resolves_ingredients_to_foods(client, headers, user, db, ready) -> None:
    res = plan(client, headers, preferences="  no pork, simple food ")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["targets"] == {"energy_kcal": 2000, "protein_g": 160, "carbs_g": 180, "fat_g": 70}
    assert [(m["meal"], m["title"]) for m in body["meals"]] == [
        ("breakfast", "Milk and dragon fruit"),
        ("lunch", "Chicken and avocado"),
        ("dinner", "Hummus plate"),
    ]
    found = {i["name"]: i["food"] and i["food"]["name"] for i in ingredients(body)}
    assert found == {
        "Milk": "Milk 3% fat",  # not in USDA, so found on OFF
        "Dragon fruit": None,
        "Roast chicken breast": "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
        "Avocado": "Avocados, raw, all commercial varieties",
        "Hummus": "Demo hummus",
        "Chicken breast": "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
    }
    assert body["unresolved"] == 1
    chicken = body["meals"][1]["ingredients"][0]
    assert chicken["food"]["id"] is not None  # cached, so it can be logged straight away
    assert chicken["grams"] == 180
    assert chicken["nutrients"] == {
        "energy_kcal": 297.0,
        "protein_g": 55.8,
        "carbs_g": 0.0,
        "fat_g": 6.4,
        "sodium_mg": 133.2,
        "vit_b12_mcg": 0.6,
    }
    assert body["meals"][0]["ingredients"][1]["nutrients"] == {}
    assert body["meals"][1]["totals"]["energy_kcal"] == 297 + 112
    assert body["totals"]["energy_kcal"] == round(
        sum(m["totals"]["energy_kcal"] for m in body["meals"]), 1
    )
    # "chicken" and "Chicken" are one search; USDA was asked once per distinct term
    assert ready["usda"].calls == 5
    assert ready["off"].calls == 3

    settings = client.get("/ai/settings", headers=headers).json()
    assert settings["plan_preferences"] == "no pork, simple food"
    with psycopg.connect(db) as conn:
        assert conn.execute(
            "select feature, outcome from ai_usage where user_id = %s", (user,)
        ).fetchall() == [("meal_plan", "ok")]
        assert conn.execute("select count(*) from food_log").fetchone() == (0,)


def test_plan_prefers_cached_and_own_foods(client, headers, ready) -> None:
    own = client.post(
        "/foods",
        json={"name": "Grandma's chicken", "nutrients_per_100g": {"energy_kcal": 200}},
        headers=headers,
    ).json()
    assert plan(client, headers).status_code == 200
    calls = ready["usda"].calls, ready["off"].calls
    body = plan(client, headers).json()
    chicken = body["meals"][1]["ingredients"][0]
    assert chicken["food"]["id"] == own["id"]
    # everything found before is cached now; only the unknown fruit is searched again
    assert (ready["usda"].calls, ready["off"].calls) == (calls[0] + 1, calls[1] + 1)


def test_plan_survives_a_failing_source(client, headers, ready) -> None:
    ready["usda"].fail = True
    body = plan(client, headers).json()
    # OFF only takes the first three leftovers (milk, dragonfruit, chicken): it's rate limited
    assert [i["name"] for i in ingredients(body) if i["food"]] == ["Milk"]
    assert body["unresolved"] == 5


def test_plan_for_the_rest_of_today(client, headers, ready) -> None:
    eaten = {"nutrients": {"energy_kcal": 1200, "protein_g": 100}, "meal": "breakfast"}
    client.post("/food-log/quick", json={**eaten, "eaten_at": AT}, headers=headers)
    body = plan(client, headers, meals=2, rest_of_today=True).json()
    assert body["rest_of_today"] is True
    assert body["targets"] == {"energy_kcal": 800, "protein_g": 60, "carbs_g": 180, "fat_g": 70}

    client.post("/food-log/quick", json={**eaten, "eaten_at": AT}, headers=headers)
    res = plan(client, headers, meals=2, rest_of_today=True)
    assert res.status_code == 422
    assert res.json()["detail"] == "There's not much left of today's targets to plan"


def test_plan_validates_input(client, headers, ready) -> None:
    assert plan(client, headers, meals=1).status_code == 422
    assert plan(client, headers, meals=6).status_code == 422
    assert plan(client, headers, preferences="x" * 501).status_code == 422


def test_plan_ai_failure_still_remembers_preferences(client, headers, ready) -> None:
    res = plan(client, headers, preferences="__unavailable__")
    assert res.json()["code"] == "ai_unavailable"
    assert client.get("/ai/settings", headers=headers).json()["plan_preferences"] == (
        "__unavailable__"
    )


def test_recipes_from_groceries(client, headers, user, db, ready) -> None:
    res = client.post(
        "/ai/recipes-from-groceries",
        json={"groceries": "chicken, avocado\nhummus", "servings": 2},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert [r["name"] for r in body["recipes"]] == ["Chicken avocado salad", "Hummus chicken bowl"]
    salad = body["recipes"][0]
    assert salad["servings"] == 2 and salad["minutes"] == 15 and len(salad["steps"]) == 3
    assert [i["food"] is not None for i in salad["ingredients"]] == [True, True, False]
    assert salad["totals"]["energy_kcal"] == 495 + 240
    assert salad["per_serving"]["energy_kcal"] == 367.5
    assert body["unresolved"] == 1
    with psycopg.connect(db) as conn:
        assert conn.execute(
            "select feature from ai_usage where user_id = %s", (user,)
        ).fetchall() == [("recipe_from_groceries",)]


@pytest.mark.parametrize(
    "body",
    [
        {"groceries": " , \n - "},
        {"groceries": ", ".join(f"item {n}" for n in range(41))},
        {"groceries": "eggs", "servings": 13},
    ],
)
def test_recipes_validate_groceries(client, headers, ready, body) -> None:
    assert client.post("/ai/recipes-from-groceries", json=body, headers=headers).status_code == 422


def test_saved_recipe_keeps_instructions(client, headers, ready) -> None:
    idea = client.post(
        "/ai/recipes-from-groceries", json={"groceries": "chicken, hummus"}, headers=headers
    ).json()["recipes"][1]
    body = {
        "name": idea["name"],
        "servings": idea["servings"],
        "instructions": "\n".join(f"{n}. {s}" for n, s in enumerate(idea["steps"], 1)),
        "items": [{"food_id": i["food"]["id"], "grams": i["grams"]} for i in idea["ingredients"]],
    }
    res = client.post("/recipes", json=body, headers=headers)
    assert res.status_code == 201, res.text
    saved = res.json()
    assert (
        saved["instructions"] == "1. Spread the hummus in two bowls.\n2. Top with sliced chicken."
    )
    again = client.get(f"/recipes/{saved['id']}", headers=headers).json()
    assert again["instructions"] == saved["instructions"]
    too_long = {**body, "instructions": "x" * 4001}
    assert client.post("/recipes", json=too_long, headers=headers).status_code == 422


def test_grocery_list_parsing() -> None:
    assert grocery_list("- eggs, tomatoes\n\n* chicken\t\n• feta,") == [
        "eggs",
        "tomatoes",
        "chicken",
        "feta",
    ]


def test_prompts_quote_user_text() -> None:
    text = meal_plan.user_text(
        meals=3,
        energy_kcal=1999.6,
        protein_g=160,
        carbs_g=180,
        fat_g=70.2,
        rest_of_today=False,
        preferences="kosher",
    )
    assert "Plan 3 meals for a whole day." in text
    assert "2000 kcal, 160 g protein, 180 g carbohydrate, 70 g fat" in text
    assert text.endswith("<user_input>\nkosher\n</user_input>")
    assert "<user_input>" not in meal_plan.user_text(
        meals=2,
        energy_kcal=500,
        protein_g=40,
        carbs_g=50,
        fat_g=10,
        rest_of_today=True,
        preferences="",
    )
    text = recipes_from_groceries.user_text(
        groceries=["eggs", "feta"], servings=None, staples=False
    )
    assert text.startswith("Use only these groceries. Choose sensible servings.")
    assert text.endswith("<user_input>\n- eggs\n- feta\n</user_input>")
