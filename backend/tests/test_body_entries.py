from tests.conftest import auth_for

BASE = {"measured_at": "2026-02-28T06:30:00+02:00", "weight_kg": 82.4}


def test_create_minimal_entry(client, headers) -> None:
    res = client.post("/body-entries", json=BASE, headers=headers)
    assert res.status_code == 201
    body = res.json()
    assert body["weight_kg"] == 82.4
    assert body["body_fat_pct"] is None
    assert body["id"]


def test_create_full_entry(client, headers) -> None:
    full = {
        **BASE,
        "body_fat_pct": 18.3,
        "muscle_mass_kg": 63.1,
        "skeletal_muscle_pct": 44.0,
        "body_water_pct": 57.2,
        "bone_mass_kg": 3.3,
        "visceral_fat": 8,
        "protein_pct": 18.1,
        "bmr_kcal": 1780,
        "metabolic_age": 31,
        "note": "after coffee",
    }
    res = client.post("/body-entries", json=full, headers=headers)
    assert res.status_code == 201
    assert res.json()["bmr_kcal"] == 1780


def test_weight_required_and_ranges(client, headers) -> None:
    res = client.post("/body-entries", json={"measured_at": BASE["measured_at"]}, headers=headers)
    assert res.status_code == 422
    res = client.post("/body-entries", json={**BASE, "weight_kg": 800}, headers=headers)
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"][-1] == "weight_kg"
    res = client.post("/body-entries", json={**BASE, "body_fat_pct": 95}, headers=headers)
    assert res.status_code == 422


def test_future_and_naive_dates_rejected(client, headers) -> None:
    # FIXED_NOW is 2026-03-01T12:00Z
    future = {**BASE, "measured_at": "2026-03-02T12:00:00Z"}
    assert client.post("/body-entries", json=future, headers=headers).status_code == 422
    naive = {**BASE, "measured_at": "2026-02-28T06:30:00"}
    assert client.post("/body-entries", json=naive, headers=headers).status_code == 422


def test_list_newest_first_and_filter(client, headers) -> None:
    for day, w in (("2026-02-01", 84), ("2026-02-15", 83), ("2026-02-27", 82)):
        client.post(
            "/body-entries",
            json={"measured_at": f"{day}T07:00:00Z", "weight_kg": w},
            headers=headers,
        )
    rows = client.get("/body-entries", headers=headers).json()
    assert [r["weight_kg"] for r in rows] == [82, 83, 84]
    rows = client.get(
        "/body-entries",
        params={"from": "2026-02-10T00:00:00Z", "to": "2026-02-20T00:00:00Z"},
        headers=headers,
    ).json()
    assert [r["weight_kg"] for r in rows] == [83]


def test_patch_partial_update(client, headers) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    res = client.patch(f"/body-entries/{created['id']}", json={"body_fat_pct": 18}, headers=headers)
    assert res.status_code == 200
    assert res.json()["body_fat_pct"] == 18
    assert res.json()["weight_kg"] == 82.4


def test_patch_cannot_null_weight(client, headers) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    res = client.patch(f"/body-entries/{created['id']}", json={"weight_kg": None}, headers=headers)
    assert res.status_code == 422


def test_delete(client, headers) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    assert client.delete(f"/body-entries/{created['id']}", headers=headers).status_code == 204
    assert client.get("/body-entries", headers=headers).json() == []
    assert client.delete(f"/body-entries/{created['id']}", headers=headers).status_code == 404


def test_other_user_cannot_see_edit_or_delete(client, headers, make_user) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    other = auth_for(make_user())
    url = f"/body-entries/{created['id']}"
    assert client.get("/body-entries", headers=other).json() == []
    assert client.patch(url, json={"weight_kg": 50}, headers=other).status_code == 404
    assert client.delete(url, headers=other).status_code == 404
    assert client.get("/body-entries", headers=headers).json()[0]["weight_kg"] == 82.4
