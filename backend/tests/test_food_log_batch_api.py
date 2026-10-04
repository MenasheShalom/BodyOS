from typing import Any

from tests.conftest import auth_for
from tests.test_food_log_api import HUMMUS, PROFILE, day

AT = "2026-03-01T13:00:00+02:00"


def batch(client, headers, entries: list[dict[str, Any]]) -> Any:
    return client.post("/food-log/batch", json={"entries": entries}, headers=headers)


def quick_entry(**extra: Any) -> dict[str, Any]:
    return {
        "kind": "quick",
        "name": "White rice",
        "nutrients": {"energy_kcal": 234, "protein_g": 4.9, "carbs_g": 51, "fat_g": 0.5},
        "meal": "lunch",
        "eaten_at": AT,
        "origin": "ai_photo",
        **extra,
    }


def setup(client, headers) -> dict[str, Any]:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    return client.post("/foods", json=HUMMUS, headers=headers).json()


def test_batch_logs_food_and_quick_entries_with_origin(client, headers) -> None:
    food = setup(client, headers)
    res = batch(
        client,
        headers,
        [
            {
                "kind": "food",
                "food_id": food["id"],
                "grams": 60,
                "meal": "lunch",
                "eaten_at": AT,
                "origin": "ai_photo",
            },
            quick_entry(),
        ],
    )
    assert res.status_code == 201, res.text
    entries = res.json()
    assert [(e["name"], e["origin"]) for e in entries] == [
        ("Hummus", "ai_photo"),
        ("White rice", "ai_photo"),
    ]
    assert entries[0]["nutrients"]["energy_kcal"] == 162
    logged = day(client, headers, "2026-03-01")["entries"]
    assert sorted(e["origin"] for e in logged) == ["ai_photo", "ai_photo"]


def test_origin_defaults_to_manual(client, headers) -> None:
    setup(client, headers)
    entry = quick_entry()
    del entry["origin"]
    assert batch(client, headers, [entry]).json()[0]["origin"] == "manual"
    single = client.post(
        "/food-log/quick",
        json={"nutrients": {"energy_kcal": 100}, "meal": "snack", "eaten_at": AT},
        headers=headers,
    ).json()
    assert single["origin"] == "manual"


def test_batch_is_all_or_nothing(client, headers, make_user) -> None:
    setup(client, headers)
    other = auth_for(make_user())
    client.put("/me/profile", json=PROFILE, headers=other)
    theirs = client.post("/foods", json=HUMMUS, headers=other).json()
    res = batch(
        client,
        headers,
        [
            quick_entry(),
            {"kind": "food", "food_id": theirs["id"], "grams": 50, "meal": "lunch", "eaten_at": AT},
        ],
    )
    assert res.status_code == 404
    assert day(client, headers, "2026-03-01")["entries"] == []


def test_batch_validation(client, headers) -> None:
    setup(client, headers)
    assert batch(client, headers, []).status_code == 422
    assert batch(client, headers, [quick_entry()] * 21).status_code == 422
    bad = quick_entry(nutrients={"energy_kcal": 0})
    assert batch(client, headers, [bad]).status_code == 422
    assert batch(client, headers, [quick_entry(origin="robot")]).status_code == 422
    future = quick_entry(eaten_at="2026-03-05T13:00:00+02:00")
    assert batch(client, headers, [future]).status_code == 422
