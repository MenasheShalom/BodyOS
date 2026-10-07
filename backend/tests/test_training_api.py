from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest

from app.clock import get_now
from tests.conftest import FIXED_NOW, auth_for

PROFILE = {
    "height_cm": 168,
    "sex": "male",
    "date_of_birth": "1988-01-01",
    "timezone": "Asia/Jerusalem",
}
HOME = {"name": "Home", "equipment": ["dumbbells", "bench", "pull_up_bar"], "notes": "Up to 20 kg"}
GYM = {"name": "Gym", "equipment": ["barbell", "squat_rack", "machines", "cable_machine"]}
TRAINING = {
    "experience": "some",
    "limitations": "bad left knee",
    "days_per_week": 3,
    "session_minutes": 45,
    "cardio": "light",
}


@pytest.fixture
def ready(client, headers, ai) -> dict[str, Any]:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    assert client.put("/training/profile", json=TRAINING, headers=headers).status_code == 200
    home = client.post("/training/locations", json=HOME, headers=headers).json()
    gym = client.post("/training/locations", json=GYM, headers=headers).json()
    return {"home": home, "gym": gym}


def generate(client, headers, *ids: str) -> Any:
    return client.post("/training/programs", json={"location_ids": list(ids)}, headers=headers)


def test_equipment_and_locations(client, headers, make_user) -> None:
    keys = [e["key"] for e in client.get("/training/equipment", headers=headers).json()]
    assert "dumbbells" in keys and "pull_up_bar" in keys
    res = client.post(
        "/training/locations",
        json={"name": " Home ", "equipment": ["pull_up_bar", "dumbbells", "dumbbells"]},
        headers=headers,
    )
    assert res.status_code == 201
    loc = res.json()
    assert (loc["name"], loc["equipment"], loc["notes"]) == (
        "Home",
        ["dumbbells", "pull_up_bar"],
        "",
    )
    bad = client.post(
        "/training/locations", json={"name": "x", "equipment": ["laser"]}, headers=headers
    )
    assert bad.status_code == 422
    updated = client.put(
        f"/training/locations/{loc['id']}", json={**HOME, "name": "Flat"}, headers=headers
    ).json()
    assert updated["name"] == "Flat"
    assert [x["name"] for x in client.get("/training/locations", headers=headers).json()] == [
        "Flat"
    ]
    other = auth_for(make_user())
    assert client.delete(f"/training/locations/{loc['id']}", headers=other).status_code == 404
    assert client.delete(f"/training/locations/{loc['id']}", headers=headers).status_code == 204


def test_location_limit(client, headers) -> None:
    for i in range(6):
        assert (
            client.post("/training/locations", json={"name": f"L{i}"}, headers=headers).status_code
            == 201
        )
    assert (
        client.post("/training/locations", json={"name": "L7"}, headers=headers).status_code == 422
    )


def test_training_profile(client, headers) -> None:
    assert client.get("/training/profile", headers=headers).json()["configured"] is False
    res = client.put("/training/profile", json=TRAINING, headers=headers).json()
    assert res == {**TRAINING, "configured": True}
    bad = {**TRAINING, "days_per_week": 7}
    assert client.put("/training/profile", json=bad, headers=headers).status_code == 422


def test_generate_needs_setup(client, headers, ai) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    home = client.post("/training/locations", json=HOME, headers=headers).json()
    res = generate(client, headers, home["id"])
    assert (res.status_code, res.json()["detail"]) == (409, "Set up your training profile first")


def test_generate_and_follow_a_program(client, headers, user, db, ready) -> None:
    home, gym = ready["home"], ready["gym"]
    res = generate(client, headers, home["id"], gym["id"])
    assert res.status_code == 201, res.text
    program = res.json()
    assert program["name"] == "Full body, 3 days" and program["weeks"] == 6
    assert program["daily_steps"] == 9000 and program["started_on"] == "2026-03-01"
    days = program["days"]
    assert [d["name"] for d in days] == ["Full body A", "Full body B", "Full body C"]
    # the fixture's third day names location 7, which doesn't exist: it goes to the first
    assert [d["location_name"] for d in days] == ["Home", "Home", "Home"]
    plank = days[0]["exercises"][2]
    assert (plank["kind"], plank["seconds"], plank["reps_low"], plank["uses_weight"]) == (
        "time",
        40,
        None,
        False,
    )
    assert days[0]["exercises"][0]["alternatives"] == ["Split squat"]
    assert client.get("/training/programs/active", headers=headers).json()["id"] == program["id"]

    with psycopg.connect(db) as conn:
        inputs, feature = conn.execute(
            "select p.inputs, u.feature from workout_programs p, ai_usage u"
            " where p.user_id = %s and u.user_id = p.user_id",
            (user,),
        ).fetchone()
    assert feature == "workout_plan"
    assert inputs["limitations"] == "bad left knee"
    assert [loc["name"] for loc in inputs["locations"]] == ["Home", "Gym"]
    assert inputs["locations"][0]["equipment"][0] == "Bodyweight"

    # move a day and swap an exercise
    moved = client.patch(
        f"/training/program-days/{days[2]['id']}", json={"location_id": gym["id"]}, headers=headers
    ).json()
    assert moved["days"][2]["location_name"] == "Gym"
    squat = days[0]["exercises"][0]
    swapped = client.post(
        f"/training/program-exercises/{squat['id']}/swap",
        json={"name": "Split squat"},
        headers=headers,
    ).json()["days"][0]["exercises"][0]
    assert (swapped["name"], swapped["alternatives"]) == ("Split squat", ["Goblet squat"])
    bad = client.post(
        f"/training/program-exercises/{squat['id']}/swap", json={"name": "Squat"}, headers=headers
    )
    assert bad.status_code == 422

    # today: day A, first time
    today = client.get("/training/today", headers=headers).json()
    assert (today["day"]["name"], today["week"], today["session"], today["sessions_done"]) == (
        "Full body A",
        1,
        None,
        0,
    )
    first = today["exercises"][0]
    assert first["suggestion"]["reps"] == 8 and first["last"] == []

    session = client.post(
        "/training/sessions", json={"program_day_id": today["day"]["id"]}, headers=headers
    ).json()
    sets = [
        {
            "exercise_id": first["exercise"]["id"],
            "exercise_name": "Split squat",
            "set_number": n,
            "weight_kg": 12,
            "reps": 12,
        }
        for n in (1, 2, 3)
    ] + [{"exercise_name": "Plank", "set_number": 1, "seconds": 40}]
    saved = client.put(
        f"/training/sessions/{session['id']}/sets",
        json={"sets": sets, "notes": "good"},
        headers=headers,
    ).json()
    assert len(saved["sets"]) == 4 and saved["notes"] == "good"
    # under way: today shows the same session
    assert client.get("/training/today", headers=headers).json()["session"]["id"] == session["id"]
    dup = sets + [sets[0]]
    assert (
        client.put(
            f"/training/sessions/{session['id']}/sets", json={"sets": dup}, headers=headers
        ).status_code
        == 422
    )
    done = client.post(f"/training/sessions/{session['id']}/complete", headers=headers).json()
    assert done["completed_at"] is not None

    # next: day B; day A again after B and C, with progression from last time
    assert client.get("/training/today", headers=headers).json()["day"]["name"] == "Full body B"
    history = client.get("/training/sessions", headers=headers).json()
    assert history[0]["sets_done"] == 4 and history[0]["volume_kg"] == 432

    for name in ("Full body B", "Full body C"):
        t = client.get("/training/today", headers=headers).json()
        assert t["day"]["name"] == name
        s = client.post(
            "/training/sessions", json={"program_day_id": t["day"]["id"]}, headers=headers
        ).json()
        client.post(f"/training/sessions/{s['id']}/complete", headers=headers)
    again = client.get("/training/today", headers=headers).json()
    assert again["day"]["name"] == "Full body A" and again["sessions_done"] == 3
    squat_next = again["exercises"][0]
    assert squat_next["suggestion"]["weight_kg"] == 13  # 12 kg × 12 on every set: +1 kg
    assert [s["reps"] for s in squat_next["last"]] == [12, 12, 12]
    plank_next = again["exercises"][2]
    assert plank_next["suggestion"]["seconds"] == 40  # only one of two sets held


def test_starting_another_day_replaces_an_open_session(client, headers, ready) -> None:
    program = generate(client, headers, ready["home"]["id"]).json()
    a, b = program["days"][0]["id"], program["days"][1]["id"]
    first = client.post("/training/sessions", json={"program_day_id": a}, headers=headers).json()
    same = client.post("/training/sessions", json={"program_day_id": a}, headers=headers).json()
    assert same["id"] == first["id"]
    other = client.post("/training/sessions", json={"program_day_id": b}, headers=headers).json()
    assert other["id"] != first["id"]
    assert client.get("/training/today", headers=headers).json()["day"]["id"] == b
    assert client.delete(f"/training/sessions/{other['id']}", headers=headers).status_code == 204


def test_new_program_replaces_the_active_one(client, headers, user, db, ready) -> None:
    first = generate(client, headers, ready["home"]["id"]).json()
    second = generate(client, headers, ready["gym"]["id"]).json()
    assert client.get("/training/programs/active", headers=headers).json()["id"] == second["id"]
    with psycopg.connect(db) as conn:
        assert conn.execute(
            "select count(*) from workout_programs where user_id = %s", (user,)
        ).fetchone() == (2,)
    assert first["id"] != second["id"]
    assert client.delete("/training/programs/active", headers=headers).status_code == 204
    assert client.get("/training/programs/active", headers=headers).json() is None
    assert client.get("/training/today", headers=headers).json() is None


def test_programs_are_private(client, headers, make_user, ready) -> None:
    program = generate(client, headers, ready["home"]["id"]).json()
    other = auth_for(make_user())
    client.put("/me/profile", json=PROFILE, headers=other)
    assert client.get("/training/programs/active", headers=other).json() is None
    day = program["days"][0]
    assert (
        client.post(
            "/training/sessions", json={"program_day_id": day["id"]}, headers=other
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/training/program-days/{day['id']}", json={"location_id": None}, headers=other
        ).status_code
        == 404
    )
    ex = day["exercises"][0]
    swap = {"name": ex["alternatives"][0]}
    assert (
        client.post(
            f"/training/program-exercises/{ex['id']}/swap", json=swap, headers=other
        ).status_code
        == 404
    )
    # someone else's location can't be used
    assert generate(client, other, ready["home"]["id"]).status_code in (404, 409)


def test_ai_failure_saves_nothing(client, headers, user, db, ready) -> None:
    client.put(
        "/training/profile", json={**TRAINING, "limitations": "__unavailable__"}, headers=headers
    )
    res = generate(client, headers, ready["home"]["id"])
    assert res.json()["code"] == "ai_unavailable"
    assert client.get("/training/programs/active", headers=headers).json() is None


def test_week_number_and_local_day(client, headers, app_under_test, ready) -> None:
    generate(client, headers, ready["home"]["id"])
    # 23:30 UTC on 9 March is already 10 March in Jerusalem: week 2
    later = datetime(2026, 3, 9, 23, 30, tzinfo=UTC)
    app_under_test.dependency_overrides[get_now] = lambda: later
    assert client.get("/training/today", headers=headers).json()["week"] == 2
    assert later - FIXED_NOW > timedelta(days=8)
