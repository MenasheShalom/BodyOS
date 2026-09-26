from datetime import date, timedelta

from tests.conftest import auth_for

BF_GOAL = {"metric": "body_fat_pct", "target_value": 15}


def _seed(client, headers, field: str, first: float, per_day: float, days: int = 21) -> None:
    start = date(2026, 3, 1) - timedelta(days=days - 1)
    for i in range(days):
        client.post(
            "/body-entries",
            json={
                "measured_at": f"{(start + timedelta(days=i)).isoformat()}T07:00:00Z",
                "weight_kg": 80,
                field: first + per_day * i,
            },
            headers=headers,
        )


def _seed_body_fat(client, headers) -> None:
    _seed(client, headers, "body_fat_pct", 20.0, -0.05)


def test_create_goal_requires_data(client, headers) -> None:
    res = client.post("/goals", json=BF_GOAL, headers=headers)
    assert res.status_code == 422
    assert "Log at least one Body fat reading" in res.json()["detail"]


def test_create_goal_captures_start_from_trend(client, headers) -> None:
    _seed_body_fat(client, headers)
    res = client.post("/goals", json=BF_GOAL, headers=headers)
    assert res.status_code == 201
    goal = res.json()
    assert goal["status"] == "active"
    assert goal["start_date"] == "2026-03-01"
    assert 19.0 < goal["start_value"] < 20.0
    assert goal["projection"]["state"] == "on_track"
    assert goal["projection"]["projected_date"] is not None
    assert 0 <= goal["projection"]["progress_pct"] <= 100


def test_duplicate_active_goal_409(client, headers) -> None:
    _seed_body_fat(client, headers)
    client.post("/goals", json=BF_GOAL, headers=headers)
    res = client.post("/goals", json={**BF_GOAL, "target_value": 14}, headers=headers)
    assert res.status_code == 409


def test_archive_then_create_new(client, headers) -> None:
    _seed_body_fat(client, headers)
    goal = client.post("/goals", json=BF_GOAL, headers=headers).json()
    res = client.patch(f"/goals/{goal['id']}", json={"status": "archived"}, headers=headers)
    assert res.json()["status"] == "archived"
    res = client.post("/goals", json={**BF_GOAL, "target_value": 14}, headers=headers)
    assert res.status_code == 201
    # re-activating the archived one now conflicts
    res = client.patch(f"/goals/{goal['id']}", json={"status": "active"}, headers=headers)
    assert res.status_code == 409


def test_list_filter_and_delete(client, headers) -> None:
    _seed_body_fat(client, headers)
    goal = client.post("/goals", json=BF_GOAL, headers=headers).json()
    assert len(client.get("/goals", params={"status": "active"}, headers=headers).json()) == 1
    assert client.get("/goals", params={"status": "archived"}, headers=headers).json() == []
    assert client.delete(f"/goals/{goal['id']}", headers=headers).status_code == 204
    assert client.get("/goals", headers=headers).json() == []


def test_upward_goal_moving_wrong_way_not_on_pace(client, headers) -> None:
    # muscle mass falling while the goal is to gain it
    _seed(client, headers, "muscle_mass_kg", 62.0, -0.05)
    res = client.post(
        "/goals", json={"metric": "muscle_mass_kg", "target_value": 65}, headers=headers
    )
    assert res.json()["projection"]["state"] == "not_on_pace"


def test_goal_isolation(client, headers, make_user) -> None:
    _seed_body_fat(client, headers)
    goal = client.post("/goals", json=BF_GOAL, headers=headers).json()
    other = auth_for(make_user())
    url = f"/goals/{goal['id']}"
    assert client.get("/goals", headers=other).json() == []
    assert client.patch(url, json={"status": "archived"}, headers=other).status_code == 404
    assert client.delete(url, headers=other).status_code == 404


def test_invalid_metric_422(client, headers) -> None:
    res = client.post("/goals", json={"metric": "bmr_kcal", "target_value": 1800}, headers=headers)
    assert res.status_code == 422
