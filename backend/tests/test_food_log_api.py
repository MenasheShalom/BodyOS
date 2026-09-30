from typing import Any

import psycopg
import pytest

from tests.conftest import auth_for

PROFILE = {
    "height_cm": 180,
    "sex": "male",
    "date_of_birth": "1988-10-01",
    "timezone": "Asia/Jerusalem",
}
HUMMUS = {
    "name": "Hummus",
    "servings": [{"label": "2 tbsp", "grams": 30}],
    "nutrients_per_100g": {"energy_kcal": 270, "protein_g": 7, "fat_g": 21, "vit_d_mcg": 0},
}


@pytest.fixture
def setup(client, headers) -> dict[str, Any]:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    food = client.post("/foods", json=HUMMUS, headers=headers).json()
    return {"food": food}


def log(client, headers, food_id: str, **extra: Any) -> dict[str, Any]:
    body = {
        "food_id": food_id,
        "grams": 60,
        "serving_label": "2 tbsp",
        "serving_count": 2,
        "meal": "lunch",
        "eaten_at": "2026-02-28T13:00:00+02:00",
        **extra,
    }
    res = client.post("/food-log", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def quick(client, headers, **extra: Any) -> dict[str, Any]:
    body = {
        "nutrients": {"energy_kcal": 450, "protein_g": 30},
        "meal": "dinner",
        "eaten_at": "2026-02-28T19:00:00+02:00",
        **extra,
    }
    res = client.post("/food-log/quick", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def day(client, headers, d: str) -> dict[str, Any]:
    res = client.get("/food-log", params={"day": d}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_log_food_computes_snapshot(client, headers, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    assert entry["name"] == "Hummus"
    assert entry["nutrients"] == {
        "energy_kcal": 162.0,
        "protein_g": 4.2,
        "fat_g": 12.6,
        "vit_d_mcg": 0.0,
    }
    assert entry["grams"] == 60 and entry["serving_count"] == 2


def test_quick_add(client, headers, setup) -> None:
    entry = quick(client, headers)
    assert entry["food_id"] is None and entry["grams"] is None
    assert entry["name"] == "Quick add"
    assert entry["nutrients"] == {"energy_kcal": 450, "protein_g": 30}


@pytest.mark.parametrize(
    "nutrients",
    [{"energy_kcal": 100, "sodium_mg": 5}, {"protein_g": 5}, {"energy_kcal": 0}],
)
def test_quick_add_validation(client, headers, setup, nutrients: dict[str, float]) -> None:
    body = {"nutrients": nutrients, "meal": "snack", "eaten_at": "2026-02-28T10:00:00Z"}
    assert client.post("/food-log/quick", json=body, headers=headers).status_code == 422


def test_cannot_log_other_users_custom_food(client, headers, make_user, setup) -> None:
    other = auth_for(make_user())
    body = {
        "food_id": setup["food"]["id"],
        "grams": 50,
        "meal": "lunch",
        "eaten_at": "2026-02-28T13:00:00Z",
    }
    assert client.post("/food-log", json=body, headers=other).status_code == 404


def test_can_log_shared_food(client, headers, setup, db) -> None:
    with psycopg.connect(db) as conn:
        row = conn.execute(
            "insert into foods (source, source_ref, name, nutrients_per_100g)"
            """ values ('off', '1', 'Pita', '{"energy_kcal": 250}') returning id"""
        ).fetchone()
    assert row is not None
    entry = log(client, headers, str(row[0]), grams=90)
    assert entry["nutrients"] == {"energy_kcal": 225.0}


def test_editing_food_does_not_change_logged_entry(client, headers, setup) -> None:
    log(client, headers, setup["food"]["id"])
    before = day(client, headers, "2026-02-28")
    changed = {**HUMMUS, "nutrients_per_100g": {"energy_kcal": 500}}
    client.put(f"/foods/{setup['food']['id']}", json=changed, headers=headers)
    assert day(client, headers, "2026-02-28") == before


def test_patch_grams_scales_snapshot(client, headers, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    res = client.patch(
        f"/food-log/{entry['id']}",
        json={"grams": 90, "serving_count": 3},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["nutrients"]["energy_kcal"] == 243.0
    assert res.json()["serving_count"] == 3


def test_patch_meal_and_time(client, headers, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    res = client.patch(
        f"/food-log/{entry['id']}",
        json={"meal": "snack", "eaten_at": "2026-02-28T16:00:00+02:00"},
        headers=headers,
    )
    assert res.json()["meal"] == "snack"
    assert res.json()["nutrients"] == entry["nutrients"]


def test_patch_nutrients_on_food_entry_422(client, headers, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    res = client.patch(
        f"/food-log/{entry['id']}", json={"nutrients": {"energy_kcal": 10}}, headers=headers
    )
    assert res.status_code == 422


def test_patch_quick_add(client, headers, setup) -> None:
    entry = quick(client, headers)
    res = client.patch(
        f"/food-log/{entry['id']}",
        json={"nutrients": {"energy_kcal": 500}, "name": "Pizza"},
        headers=headers,
    )
    assert res.json()["nutrients"] == {"energy_kcal": 500} and res.json()["name"] == "Pizza"
    grams = client.patch(f"/food-log/{entry['id']}", json={"grams": 100}, headers=headers)
    assert grams.status_code == 422


def test_patch_rejects_null_required(client, headers, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    res = client.patch(f"/food-log/{entry['id']}", json={"meal": None}, headers=headers)
    assert res.status_code == 422


def test_day_view_uses_profile_timezone(client, headers, setup) -> None:
    late = log(client, headers, setup["food"]["id"], eaten_at="2026-02-28T23:40:00+02:00")
    early = log(client, headers, setup["food"]["id"], eaten_at="2026-03-01T00:10:00+02:00")
    assert [e["id"] for e in day(client, headers, "2026-02-28")["entries"]] == [late["id"]]
    assert [e["id"] for e in day(client, headers, "2026-03-01")["entries"]] == [early["id"]]


def test_day_defaults_to_local_today(client, headers, setup) -> None:
    # FIXED_NOW is 2026-03-01 12:00 UTC = 14:00 in Jerusalem
    entry = log(client, headers, setup["food"]["id"], eaten_at="2026-03-01T08:00:00+02:00")
    res = client.get("/food-log", headers=headers).json()
    assert res["day"] == "2026-03-01" and [e["id"] for e in res["entries"]] == [entry["id"]]


def test_day_view_totals_and_coverage(client, headers, setup) -> None:
    log(client, headers, setup["food"]["id"])  # 162 kcal, reports vitamin D
    quick(client, headers, eaten_at="2026-02-28T20:00:00+02:00")  # 450 kcal, no vitamin D
    body = day(client, headers, "2026-02-28")
    assert body["totals"]["energy_kcal"] == pytest.approx(612)
    assert body["totals"]["protein_g"] == pytest.approx(34.2)
    assert body["coverage"]["vit_d_mcg"] == pytest.approx(162 / 612, abs=1e-3)
    assert body["coverage"]["zinc_mg"] == 0
    assert [e["meal"] for e in body["entries"]] == ["lunch", "dinner"]


def test_empty_day(client, headers, setup) -> None:
    body = day(client, headers, "2026-02-01")
    assert body["entries"] == [] and body["totals"] == {} and body["target"] is None


def test_day_view_target_in_force(client, headers, user, setup, db) -> None:
    with psycopg.connect(db) as conn:
        for start, kcal in (("2026-02-01", 2300), ("2026-02-20", 2200)):
            conn.execute(
                "insert into nutrition_targets (user_id, effective_from, energy_kcal, protein_g,"
                " carbs_g, fat_g, fiber_g, origin) values (%s, %s, %s, 170, 250, 70, 30,"
                " 'manual')",
                (user, start, kcal),
            )
    assert day(client, headers, "2026-02-19")["target"]["energy_kcal"] == 2300
    assert day(client, headers, "2026-02-20")["target"]["energy_kcal"] == 2200
    assert day(client, headers, "2026-01-31")["target"] is None


def test_future_eaten_at_422(client, headers, setup) -> None:
    body = {
        "food_id": setup["food"]["id"],
        "grams": 50,
        "meal": "lunch",
        "eaten_at": "2026-03-02T13:00:00Z",
    }
    assert client.post("/food-log", json=body, headers=headers).status_code == 422


def test_log_isolation(client, headers, make_user, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    other = auth_for(make_user())
    assert day(client, other, "2026-02-28")["entries"] == []
    assert (
        client.patch(f"/food-log/{entry['id']}", json={"grams": 1}, headers=other).status_code
        == 404
    )
    assert client.delete(f"/food-log/{entry['id']}", headers=other).status_code == 404


def test_delete_entry(client, headers, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    assert client.delete(f"/food-log/{entry['id']}", headers=headers).status_code == 204
    assert day(client, headers, "2026-02-28")["entries"] == []


def test_deleting_logged_food_keeps_entry(client, headers, setup) -> None:
    entry = log(client, headers, setup["food"]["id"])
    client.delete(f"/foods/{setup['food']['id']}", headers=headers)
    [kept] = day(client, headers, "2026-02-28")["entries"]
    assert kept["name"] == "Hummus" and kept["food_id"] == setup["food"]["id"]
    assert kept["nutrients"] == entry["nutrients"]


def test_day_without_profile_uses_utc(client, headers) -> None:
    body = {"nutrients": {"energy_kcal": 100}, "meal": "snack", "eaten_at": "2026-02-28T23:30:00Z"}
    client.post("/food-log/quick", json=body, headers=headers)
    assert len(day(client, headers, "2026-02-28")["entries"]) == 1
