import pytest

from tests.conftest import auth_for

PROFILE = {
    "height_cm": 180,
    "sex": "male",
    "date_of_birth": "1988-10-01",
    "timezone": "Asia/Jerusalem",
}
TARGETS = {
    "effective_from": "2026-03-01",
    "energy_kcal": 2300,
    "protein_g": 170,
    "carbs_g": 250,
    "fat_g": 70,
    "fiber_g": 30,
    "origin": "manual",
}


@pytest.fixture
def profile(client, headers) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200


def weigh_in(client, headers, **extra) -> None:
    body = {"measured_at": "2026-02-28T07:00:00+02:00", "weight_kg": 85, **extra}
    assert client.post("/body-entries", json=body, headers=headers).status_code == 201


def test_settings_defaults_unconfigured(client, headers) -> None:
    assert client.get("/nutrition/settings", headers=headers).json() == {
        "mode": "recomp",
        "deficit_pct": None,
        "protein_g_per_kg": 2.0,
        "activity_level": "light",
        "check_in_weekday": 6,
        "food_country": "en:israel",
        "configured": False,
    }


def test_settings_roundtrip(client, headers) -> None:
    body = {"mode": "cut", "deficit_pct": 15, "protein_g_per_kg": 2.2, "activity_level": "moderate"}
    res = client.put("/nutrition/settings", json=body, headers=headers)
    assert res.status_code == 200
    saved = client.get("/nutrition/settings", headers=headers).json()
    assert saved["configured"] is True
    assert saved["mode"] == "cut" and saved["deficit_pct"] == 15
    assert saved["protein_g_per_kg"] == 2.2 and saved["check_in_weekday"] == 6
    client.put("/nutrition/settings", json={"mode": "recomp"}, headers=headers)
    assert client.get("/nutrition/settings", headers=headers).json()["deficit_pct"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"deficit_pct": 30},
        {"protein_g_per_kg": 1.0},
        {"check_in_weekday": 7},
        {"mode": "bulk"},
        {"food_country": "en:mars"},
    ],
)
def test_settings_validation(client, headers, body) -> None:
    assert client.put("/nutrition/settings", json=body, headers=headers).status_code == 422


def test_estimate_mifflin_without_body_fat(client, headers, profile) -> None:
    weigh_in(client, headers)
    res = client.get("/nutrition/estimate", params={"activity_level": "light"}, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    # age 37 on 2026-03-01: 10*85 + 6.25*180 - 5*37 + 5 = 1795; x 1.375 = 2468
    assert body["method"] == "mifflin" and body["bmr"] == 1795 and body["tdee"] == 2468
    assert body["lean_mass_kg"] is None
    assert body["targets"] == {
        "energy_kcal": 2220,
        "protein_g": 170,
        "carbs_g": 245,
        "fat_g": 60,
        "fiber_g": 30,
    }


def test_estimate_katch_with_body_fat(client, headers, profile) -> None:
    weigh_in(client, headers, body_fat_pct=20)
    body = client.get("/nutrition/estimate", headers=headers).json()
    assert body["method"] == "katch"
    assert body["lean_mass_kg"] == 68
    assert body["bmr"] == round(370 + 21.6 * 68)


def test_estimate_uses_settings_overrides(client, headers, profile) -> None:
    weigh_in(client, headers)
    body = client.get(
        "/nutrition/estimate",
        params={"mode": "maintain", "activity_level": "moderate", "protein_g_per_kg": 1.8},
        headers=headers,
    ).json()
    assert body["targets"]["energy_kcal"] == 2780  # 1795 x 1.55 = 2782, no deficit
    assert body["targets"]["protein_g"] == 155  # 1.8 x 85 = 153


def test_estimate_needs_weigh_in_409(client, headers, profile) -> None:
    res = client.get("/nutrition/estimate", headers=headers)
    assert res.status_code == 409 and res.json()["detail"] == "Log a weigh-in first"


def test_estimate_needs_profile_409(client, headers) -> None:
    res = client.get("/nutrition/estimate", headers=headers)
    assert res.status_code == 409 and res.json()["detail"] == "Complete your profile first"


def test_targets_upsert_same_day(client, headers, profile) -> None:
    assert client.post("/nutrition/targets", json=TARGETS, headers=headers).status_code == 201
    again = {**TARGETS, "energy_kcal": 2200, "origin": "suggested", "tdee_at_creation": 2450}
    res = client.post("/nutrition/targets", json=again, headers=headers)
    assert res.json()["energy_kcal"] == 2200 and res.json()["tdee_at_creation"] == 2450
    history = client.get("/nutrition/targets", headers=headers).json()
    assert len(history) == 1


def test_targets_history_newest_first(client, headers, profile) -> None:
    client.post(
        "/nutrition/targets", json={**TARGETS, "effective_from": "2026-02-01"}, headers=headers
    )
    client.post("/nutrition/targets", json=TARGETS, headers=headers)
    history = client.get("/nutrition/targets", headers=headers).json()
    assert [t["effective_from"] for t in history] == ["2026-03-01", "2026-02-01"]


def test_targets_cannot_start_far_in_future(client, headers, profile) -> None:
    tomorrow = {**TARGETS, "effective_from": "2026-03-02"}
    assert client.post("/nutrition/targets", json=tomorrow, headers=headers).status_code == 201
    later = {**TARGETS, "effective_from": "2026-03-03"}
    assert client.post("/nutrition/targets", json=later, headers=headers).status_code == 422


def test_targets_validation(client, headers, profile) -> None:
    res = client.post("/nutrition/targets", json={**TARGETS, "energy_kcal": 500}, headers=headers)
    assert res.status_code == 422


def test_current_target_by_day(client, headers, profile) -> None:
    assert client.get("/nutrition/targets/current", headers=headers).json() is None
    client.post(
        "/nutrition/targets", json={**TARGETS, "effective_from": "2026-02-10"}, headers=headers
    )
    assert client.get("/nutrition/targets/current", headers=headers).json()["energy_kcal"] == 2300
    res = client.get("/nutrition/targets/current", params={"day": "2026-02-01"}, headers=headers)
    assert res.json() is None


def test_targets_isolation(client, headers, make_user, profile) -> None:
    client.post("/nutrition/targets", json=TARGETS, headers=headers)
    client.put("/nutrition/settings", json={"mode": "cut"}, headers=headers)
    other = auth_for(make_user())
    assert client.get("/nutrition/targets", headers=other).json() == []
    assert client.get("/nutrition/settings", headers=other).json()["configured"] is False
