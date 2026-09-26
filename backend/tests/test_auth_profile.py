import uuid

from tests.conftest import auth_for, make_token

PROFILE = {
    "height_cm": 180,
    "sex": "male",
    "date_of_birth": "1990-05-01",
    "timezone": "Asia/Jerusalem",
    "hidden_metrics": ["protein_pct"],
}


def test_missing_token_is_401(client) -> None:
    assert client.get("/me/profile").status_code == 401


def test_expired_token_is_401(client, user) -> None:
    token = make_token(user, expires_in=-10)
    res = client.get("/me/profile", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_wrong_secret_is_401(client, user) -> None:
    token = make_token(user, secret="another-secret-that-is-also-32-chars-long")
    res = client.get("/me/profile", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_garbage_token_is_401(client) -> None:
    res = client.get("/me/profile", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401


def test_profile_404_before_setup(client, headers) -> None:
    res = client.get("/me/profile", headers=headers)
    assert res.status_code == 404
    assert res.json()["detail"] == "Profile not set up"


def test_put_then_get_profile(client, headers) -> None:
    res = client.put("/me/profile", json=PROFILE, headers=headers)
    assert res.status_code == 200
    assert res.json() == {**PROFILE, "height_cm": 180.0}
    assert client.get("/me/profile", headers=headers).json()["timezone"] == "Asia/Jerusalem"


def test_put_updates_existing_profile(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.put("/me/profile", json={**PROFILE, "height_cm": 181.5}, headers=headers)
    assert res.json()["height_cm"] == 181.5


def test_invalid_timezone_422(client, headers) -> None:
    res = client.put("/me/profile", json={**PROFILE, "timezone": "Mars/Base"}, headers=headers)
    assert res.status_code == 422


def test_height_out_of_range_422(client, headers) -> None:
    res = client.put("/me/profile", json={**PROFILE, "height_cm": 300}, headers=headers)
    assert res.status_code == 422


def test_unknown_hidden_metric_422(client, headers) -> None:
    res = client.put(
        "/me/profile", json={**PROFILE, "hidden_metrics": ["weight_kg"]}, headers=headers
    )
    assert res.status_code == 422


def test_profiles_are_isolated(client, headers, make_user) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    other = make_user()
    assert client.get("/me/profile", headers=auth_for(other)).status_code == 404


def test_tampered_token_is_401(client) -> None:
    token = make_token(uuid.uuid4())
    bad = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    assert client.get("/me/profile", headers={"Authorization": f"Bearer {bad}"}).status_code == 401
