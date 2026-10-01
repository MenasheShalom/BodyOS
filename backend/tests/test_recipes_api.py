from typing import Any

import psycopg
import pytest

from tests.conftest import auth_for


@pytest.fixture
def foods(client, headers) -> dict[str, dict[str, Any]]:
    def make(name: str, nutrients: dict[str, float]) -> dict[str, Any]:
        res = client.post(
            "/foods", json={"name": name, "nutrients_per_100g": nutrients}, headers=headers
        )
        assert res.status_code == 201, res.text
        return res.json()

    return {
        "lentils": make("Lentils", {"energy_kcal": 116, "protein_g": 9, "iron_mg": 3.3}),
        "onion": make("Onion", {"energy_kcal": 40, "protein_g": 1.1}),
    }


def recipe_body(foods: dict[str, dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {
        "name": "Lentil soup",
        "servings": 4,
        "items": [
            {"food_id": foods["lentils"]["id"], "grams": 400},
            {"food_id": foods["onion"]["id"], "grams": 100},
        ],
        **extra,
    }


def create(client, headers, body: dict[str, Any]) -> dict[str, Any]:
    res = client.post("/recipes", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def test_create_computes_per_serving(client, headers, foods) -> None:
    r = create(client, headers, recipe_body(foods))
    # 400 g lentils = 464 kcal, 36 g protein; 100 g onion = 40 kcal, 1.1 g protein
    assert r["total_grams"] == 500 and r["serving_grams"] == 125
    assert r["per_serving"] == {"energy_kcal": 126.0, "protein_g": 9.3}
    assert r["incomplete_nutrients"] == ["iron_mg"]  # onion doesn't report iron
    assert [i["name"] for i in r["items"]] == ["Lentils", "Onion"]
    assert r["items"][0]["nutrients"]["energy_kcal"] == 464


def test_cooked_weight_changes_per_100g_not_per_serving(client, headers, foods) -> None:
    r = create(client, headers, recipe_body(foods, cooked_weight_g=1000))
    assert r["serving_grams"] == 250
    assert r["per_serving"]["energy_kcal"] == 126.0
    food = client.get(f"/foods/{r['food_id']}", headers=headers).json()
    assert food["source"] == "recipe"
    assert food["nutrients_per_100g"]["energy_kcal"] == pytest.approx(50.4)
    assert food["servings"] == [{"label": "1 serving", "grams": 250.0}]


def test_recipe_is_searchable_and_loggable(client, headers, foods) -> None:
    r = create(client, headers, recipe_body(foods))
    found = client.get(
        "/foods/search", params={"q": "lentil soup", "external": "false"}, headers=headers
    )
    assert [f["id"] for f in found.json()["local"]] == [r["food_id"]]
    body = {
        "food_id": r["food_id"],
        "grams": 125,
        "serving_label": "1 serving",
        "serving_count": 1,
        "meal": "dinner",
        "eaten_at": "2026-02-28T19:00:00Z",
    }
    entry = client.post("/food-log", json=body, headers=headers).json()
    assert entry["nutrients"]["energy_kcal"] == 126.0


def test_update_recomputes(client, headers, foods) -> None:
    r = create(client, headers, recipe_body(foods))
    body = recipe_body(foods, servings=2, name="Thick lentil soup")
    body["items"] = body["items"][:1]
    res = client.put(f"/recipes/{r['id']}", json=body, headers=headers)
    assert res.status_code == 200
    updated = res.json()
    assert updated["food_id"] == r["food_id"]
    assert updated["per_serving"] == {"energy_kcal": 232.0, "protein_g": 18.0, "iron_mg": 6.6}
    assert updated["incomplete_nutrients"] == []
    food = client.get(f"/foods/{r['food_id']}", headers=headers).json()
    assert food["name"] == "Thick lentil soup"


def test_nested_recipe_422(client, headers, foods) -> None:
    inner = create(client, headers, recipe_body(foods))
    body = recipe_body(foods, name="Soup plus")
    body["items"].append({"food_id": inner["food_id"], "grams": 100})
    res = client.post("/recipes", json=body, headers=headers)
    assert res.status_code == 422
    assert res.json()["detail"] == "Recipes can't contain other recipes yet"


def test_other_users_ingredient_404(client, headers, make_user, foods) -> None:
    other = auth_for(make_user())
    res = client.post("/recipes", json=recipe_body(foods), headers=other)
    assert res.status_code == 404


def test_recipe_validation(client, headers, foods) -> None:
    assert (
        client.post("/recipes", json=recipe_body(foods, servings=0), headers=headers).status_code
        == 422
    )
    assert (
        client.post(
            "/recipes", json={**recipe_body(foods), "items": []}, headers=headers
        ).status_code
        == 422
    )


def test_list_and_isolation(client, headers, make_user, foods) -> None:
    r = create(client, headers, recipe_body(foods))
    assert [x["id"] for x in client.get("/recipes", headers=headers).json()] == [r["id"]]
    other = auth_for(make_user())
    assert client.get("/recipes", headers=other).json() == []
    assert client.get(f"/recipes/{r['id']}", headers=other).status_code == 404
    assert (
        client.put(f"/recipes/{r['id']}", json=recipe_body(foods), headers=other).status_code == 404
    )
    assert client.delete(f"/recipes/{r['id']}", headers=other).status_code == 404


def test_delete_unused_recipe_removes_it(client, headers, db, foods) -> None:
    r = create(client, headers, recipe_body(foods))
    assert client.delete(f"/recipes/{r['id']}", headers=headers).status_code == 204
    with psycopg.connect(db) as conn:
        assert conn.execute("select count(*) from recipes").fetchone() == (0,)
        assert conn.execute("select count(*) from foods where source = 'recipe'").fetchone() == (0,)


def test_delete_logged_recipe_archives_it(client, headers, db, foods) -> None:
    r = create(client, headers, recipe_body(foods))
    body = {
        "food_id": r["food_id"],
        "grams": 125,
        "meal": "dinner",
        "eaten_at": "2026-02-28T19:00:00Z",
    }
    client.post("/food-log", json=body, headers=headers)
    assert client.delete(f"/recipes/{r['id']}", headers=headers).status_code == 204
    assert client.get("/recipes", headers=headers).json() == []
    with psycopg.connect(db) as conn:
        assert conn.execute("select archived from foods where source = 'recipe'").fetchone() == (
            True,
        )
    entries = client.get("/food-log", params={"day": "2026-02-28"}, headers=headers).json()[
        "entries"
    ]
    assert entries[0]["name"] == "Lentil soup"


def test_ingredient_used_in_recipe_is_archived_not_deleted(client, headers, foods) -> None:
    create(client, headers, recipe_body(foods))
    assert client.delete(f"/foods/{foods['onion']['id']}", headers=headers).status_code == 204
    assert [f["name"] for f in client.get("/foods/mine", headers=headers).json()] == ["Lentils"]
    [recipe] = client.get("/recipes", headers=headers).json()
    assert [i["name"] for i in recipe["items"]] == ["Lentils", "Onion"]  # still intact
