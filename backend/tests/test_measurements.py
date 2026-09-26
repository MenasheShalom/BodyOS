import pytest

from tests.conftest import auth_for

PROFILE = {"height_cm": 180, "sex": "male", "date_of_birth": "1990-05-01", "timezone": "UTC"}
BASE = {"measured_at": "2026-02-28T07:00:00Z", "waist_cm": 85, "neck_cm": 38}


def test_create_with_navy_estimate(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.post("/measurements", json=BASE, headers=headers)
    assert res.status_code == 201
    assert res.json()["navy_body_fat_pct"] == pytest.approx(16.1, abs=0.15)


def test_navy_is_null_without_profile_or_inputs(client, headers) -> None:
    res = client.post("/measurements", json=BASE, headers=headers)
    assert res.json()["navy_body_fat_pct"] is None
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.post(
        "/measurements", json={"measured_at": BASE["measured_at"], "arm_cm": 36}, headers=headers
    )
    assert res.json()["navy_body_fat_pct"] is None


def test_requires_at_least_one_measurement(client, headers) -> None:
    res = client.post("/measurements", json={"measured_at": BASE["measured_at"]}, headers=headers)
    assert res.status_code == 422


def test_range_validation(client, headers) -> None:
    res = client.post("/measurements", json={**BASE, "waist_cm": 400}, headers=headers)
    assert res.status_code == 422


def test_patch_and_delete(client, headers) -> None:
    created = client.post("/measurements", json=BASE, headers=headers).json()
    res = client.patch(f"/measurements/{created['id']}", json={"waist_cm": 84}, headers=headers)
    assert res.json()["waist_cm"] == 84
    assert client.delete(f"/measurements/{created['id']}", headers=headers).status_code == 204


def test_patch_cannot_clear_last_value(client, headers) -> None:
    created = client.post(
        "/measurements", json={"measured_at": BASE["measured_at"], "arm_cm": 36}, headers=headers
    ).json()
    res = client.patch(f"/measurements/{created['id']}", json={"arm_cm": None}, headers=headers)
    assert res.status_code == 422


def test_navy_preview(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.get(
        "/measurements/navy-preview", params={"waist_cm": 85, "neck_cm": 38}, headers=headers
    )
    assert res.json()["navy_body_fat_pct"] == pytest.approx(16.1, abs=0.15)


def test_isolation(client, headers, make_user) -> None:
    created = client.post("/measurements", json=BASE, headers=headers).json()
    other = auth_for(make_user())
    assert client.get("/measurements", headers=other).json() == []
    url = f"/measurements/{created['id']}"
    assert client.patch(url, json={"waist_cm": 11}, headers=other).status_code == 404
