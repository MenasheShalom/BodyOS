from typing import Any

from tests.conftest import auth_for

FOOD = {"name": "Oats", "nutrients_per_100g": {"energy_kcal": 380}, "servings": []}


def create_food(client, headers, name: str) -> dict[str, Any]:
    res = client.post("/foods", json={**FOOD, "name": name}, headers=headers)
    assert res.status_code == 201
    return res.json()


def log(client, headers, food_id: str, eaten_at: str, grams: float = 50, **extra: Any) -> None:
    body = {"food_id": food_id, "grams": grams, "meal": "breakfast", "eaten_at": eaten_at, **extra}
    assert client.post("/food-log", json=body, headers=headers).status_code == 201


def test_favourite_roundtrip(client, headers) -> None:
    oats = create_food(client, headers, "Oats")
    apple = create_food(client, headers, "Apple")
    for f in (oats, apple, oats):  # adding twice is fine
        assert client.put(f"/favourites/{f['id']}", headers=headers).status_code == 204
    names = [f["name"] for f in client.get("/favourites", headers=headers).json()]
    assert names == ["Apple", "Oats"]
    assert client.delete(f"/favourites/{apple['id']}", headers=headers).status_code == 204
    assert [f["name"] for f in client.get("/favourites", headers=headers).json()] == ["Oats"]


def test_cannot_favourite_other_users_food(client, headers, make_user) -> None:
    oats = create_food(client, headers, "Oats")
    other = auth_for(make_user())
    assert client.put(f"/favourites/{oats['id']}", headers=other).status_code == 404
    client.put(f"/favourites/{oats['id']}", headers=headers)
    assert client.get("/favourites", headers=other).json() == []


def test_favourites_hide_archived_foods(client, headers) -> None:
    oats = create_food(client, headers, "Oats")
    client.put(f"/favourites/{oats['id']}", headers=headers)
    log(client, headers, oats["id"], "2026-02-28T08:00:00Z")
    client.delete(f"/foods/{oats['id']}", headers=headers)  # archived: it was logged
    assert client.get("/favourites", headers=headers).json() == []


def test_recent_newest_first_with_last_amount(client, headers) -> None:
    oats = create_food(client, headers, "Oats")
    apple = create_food(client, headers, "Apple")
    log(client, headers, oats["id"], "2026-02-26T08:00:00Z", grams=40)
    log(client, headers, apple["id"], "2026-02-27T08:00:00Z")
    log(
        client,
        headers,
        oats["id"],
        "2026-02-28T08:00:00Z",
        grams=60,
        serving_label="100 g",
        serving_count=0.6,
    )
    body = {"nutrients": {"energy_kcal": 300}, "meal": "lunch", "eaten_at": "2026-02-28T12:00:00Z"}
    client.post("/food-log/quick", json=body, headers=headers)  # quick adds aren't foods
    recent = client.get("/foods/recent", headers=headers).json()
    assert [r["food"]["name"] for r in recent] == ["Oats", "Apple"]
    assert recent[0]["grams"] == 60 and recent[0]["serving_count"] == 0.6
    assert recent[0]["last_eaten_at"].startswith("2026-02-28T08:00:00")


def test_recent_excludes_archived_and_other_users(client, headers, make_user) -> None:
    oats = create_food(client, headers, "Oats")
    log(client, headers, oats["id"], "2026-02-28T08:00:00Z")
    assert client.get("/foods/recent", headers=auth_for(make_user())).json() == []
    client.delete(f"/foods/{oats['id']}", headers=headers)
    assert client.get("/foods/recent", headers=headers).json() == []
