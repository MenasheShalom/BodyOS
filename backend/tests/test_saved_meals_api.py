from typing import Any

import pytest

from tests.conftest import auth_for
from tests.test_food_log_api import HUMMUS, PROFILE


@pytest.fixture
def food(client, headers) -> dict[str, Any]:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    return client.post("/foods", json=HUMMUS, headers=headers).json()


def meal_body(food: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": "Usual breakfast",
        "items": [
            {"food_id": food["id"], "grams": 60, "serving_label": "2 tbsp", "serving_count": 2},
            {"name": "Coffee", "nutrients": {"energy_kcal": 40, "protein_g": 2}},
        ],
    }


def create(client, headers, body: dict[str, Any]) -> dict[str, Any]:
    res = client.post("/saved-meals", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def test_roundtrip(client, headers, food) -> None:
    meal = create(client, headers, meal_body(food))
    assert [i["name"] for i in meal["items"]] == ["Hummus", "Coffee"]
    assert meal["items"][0]["nutrients"]["energy_kcal"] == 162.0
    assert meal["totals"]["energy_kcal"] == 202.0
    assert [m["id"] for m in client.get("/saved-meals", headers=headers).json()] == [meal["id"]]


@pytest.mark.parametrize(
    "item",
    [
        {"food_id": None},  # neither a food nor numbers
        {"nutrients": {"energy_kcal": 100}, "food_id": "00000000-0000-0000-0000-000000000000"},
        {"food_id": "00000000-0000-0000-0000-000000000000"},  # no amount
        {"nutrients": {"energy_kcal": 100, "zinc_mg": 1}},
    ],
)
def test_item_validation(client, headers, food, item: dict[str, Any]) -> None:
    res = client.post("/saved-meals", json={"name": "x", "items": [item]}, headers=headers)
    assert res.status_code == 422


def test_log_creates_entries_sharing_meal_ref(client, headers, food) -> None:
    meal = create(client, headers, meal_body(food))
    res = client.post(
        f"/saved-meals/{meal['id']}/log",
        json={"meal": "breakfast", "eaten_at": "2026-02-28T08:00:00+02:00"},
        headers=headers,
    )
    assert res.status_code == 201
    entries = res.json()
    assert [e["name"] for e in entries] == ["Hummus", "Coffee"]
    assert entries[0]["meal_ref"] == entries[1]["meal_ref"] is not None
    assert entries[0]["grams"] == 60 and entries[0]["food_id"] == food["id"]
    assert entries[1]["food_id"] is None and entries[1]["nutrients"] == {
        "energy_kcal": 40,
        "protein_g": 2,
    }
    day = client.get("/food-log", params={"day": "2026-02-28"}, headers=headers).json()
    assert day["totals"]["energy_kcal"] == 202


def test_logging_uses_the_foods_current_values(client, headers, food) -> None:
    meal = create(client, headers, meal_body(food))
    client.put(
        f"/foods/{food['id']}",
        json={**HUMMUS, "nutrients_per_100g": {"energy_kcal": 300}},
        headers=headers,
    )
    entries = client.post(
        f"/saved-meals/{meal['id']}/log",
        json={"meal": "breakfast", "eaten_at": "2026-02-28T08:00:00Z"},
        headers=headers,
    ).json()
    assert entries[0]["nutrients"] == {"energy_kcal": 180.0}


def test_from_log_keeps_quick_adds(client, headers, food) -> None:
    client.post(
        "/food-log",
        json={
            "food_id": food["id"],
            "grams": 30,
            "meal": "lunch",
            "eaten_at": "2026-02-28T13:00:00+02:00",
        },
        headers=headers,
    )
    client.post(
        "/food-log/quick",
        json={
            "name": "Salad",
            "nutrients": {"energy_kcal": 120},
            "meal": "lunch",
            "eaten_at": "2026-02-28T13:05:00+02:00",
        },
        headers=headers,
    )
    res = client.post(
        "/saved-meals/from-log",
        json={"name": "Lunch", "day": "2026-02-28", "meal": "lunch"},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    items = res.json()["items"]
    assert [(i["name"], i["food_id"] is not None) for i in items] == [
        ("Hummus", True),
        ("Salad", False),
    ]


def test_from_empty_meal_422(client, headers, food) -> None:
    res = client.post(
        "/saved-meals/from-log",
        json={"name": "x", "day": "2026-02-28", "meal": "dinner"},
        headers=headers,
    )
    assert res.status_code == 422


def test_update_and_delete(client, headers, food) -> None:
    meal = create(client, headers, meal_body(food))
    body = {**meal_body(food), "name": "Light breakfast"}
    body["items"] = body["items"][1:]
    updated = client.put(f"/saved-meals/{meal['id']}", json=body, headers=headers).json()
    assert updated["name"] == "Light breakfast" and len(updated["items"]) == 1
    assert client.delete(f"/saved-meals/{meal['id']}", headers=headers).status_code == 204
    assert client.get("/saved-meals", headers=headers).json() == []


def test_isolation(client, headers, make_user, food) -> None:
    meal = create(client, headers, meal_body(food))
    other = auth_for(make_user())
    assert client.get("/saved-meals", headers=other).json() == []
    res = client.post(
        f"/saved-meals/{meal['id']}/log",
        json={"meal": "breakfast", "eaten_at": "2026-02-28T08:00:00Z"},
        headers=other,
    )
    assert res.status_code == 404
    assert (
        client.put(f"/saved-meals/{meal['id']}", json=meal_body(food), headers=other).status_code
        == 404
    )
    assert client.delete(f"/saved-meals/{meal['id']}", headers=other).status_code == 404
    assert (
        client.post("/saved-meals", json=meal_body(food), headers=other).status_code == 404
    )  # A's food


def test_archived_food_still_logs(client, headers, food) -> None:
    meal = create(client, headers, meal_body(food))
    assert client.delete(f"/foods/{food['id']}", headers=headers).status_code == 204  # archived
    entries = client.post(
        f"/saved-meals/{meal['id']}/log",
        json={"meal": "breakfast", "eaten_at": "2026-02-28T08:00:00Z"},
        headers=headers,
    ).json()
    assert entries[0]["name"] == "Hummus"
