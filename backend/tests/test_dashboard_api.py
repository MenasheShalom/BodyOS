from datetime import date, timedelta

PROFILE = {"height_cm": 180, "sex": "male", "date_of_birth": "1990-05-01", "timezone": "UTC"}


def test_empty_dashboard(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    body = client.get("/dashboard", headers=headers).json()
    assert [m["metric"] for m in body["hero"]] == ["fat_mass_kg", "lean_mass_kg"]
    assert [m["metric"] for m in body["cards"]] == ["body_fat_pct", "muscle_mass_kg"]
    assert [m["metric"] for m in body["secondary"]] == ["weight_kg", "bmi", "waist_cm"]
    assert all(m["latest"] is None and m["sparkline"] == [] for m in body["hero"])
    assert body["goals"] == []
    assert body["nudges"] == {
        "days_since_weigh_in": None,
        "days_since_photo": None,
        "no_food_today": False,  # 12:00 UTC: before the 14:00 nudge
    }
    assert body["food_today"] == {
        "energy_kcal": 0,
        "protein_g": 0,
        "target_kcal": None,
        "target_protein_g": None,
        "entries": 0,
    }
    assert body["check_in"] is None


def test_populated_dashboard(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    start = date(2026, 1, 20)  # 39 days, last entry on Feb 27
    for i in range(39):
        client.post(
            "/body-entries",
            json={
                "measured_at": f"{(start + timedelta(days=i)).isoformat()}T07:00:00Z",
                "weight_kg": 80,
                "body_fat_pct": 20 - 0.05 * i,
                "muscle_mass_kg": 60 + 0.02 * i,
            },
            headers=headers,
        )
    client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers)
    body = client.get("/dashboard", headers=headers).json()

    fat = body["hero"][0]
    assert 14 < fat["latest"] < 16
    assert fat["change_30d"] < 0
    assert fat["sparkline"]
    assert body["cards"][0]["goal_direction"] == "down"
    assert body["cards"][1]["goal_direction"] is None
    assert body["secondary"][1]["latest"] == 24.7  # BMI 80 kg / 1.80 m
    assert len(body["goals"]) == 1
    assert body["nudges"]["days_since_weigh_in"] == 2  # last entry Feb 27, today Mar 1
    assert body["nudges"]["days_since_photo"] is None


def test_dashboard_food_today_and_check_in(client, headers, user, db, app_under_test) -> None:
    from datetime import UTC, datetime

    from app.clock import get_now
    from tests.test_insight_api import PROFILE, add_target, seed

    client.put("/me/profile", json=PROFILE, headers=headers)
    seed(db, user)  # 28 days of 2,000 kcal and a steady loss
    add_target(db, user, "2026-02-01", 2600)
    body = client.get("/dashboard", headers=headers).json()
    assert body["food_today"] == {
        "energy_kcal": 2000,
        "protein_g": 150,
        "target_kcal": 2600,
        "target_protein_g": 170,
        "entries": 1,
    }
    assert body["check_in"]["targets"]["energy_kcal"] == 2450  # capped 150 under 2,600
    assert body["nudges"]["no_food_today"] is False

    # the next afternoon (16:00 in Jerusalem) with nothing logged yet
    app_under_test.dependency_overrides[get_now] = lambda: datetime(2026, 3, 2, 14, tzinfo=UTC)
    body = client.get("/dashboard", headers=headers).json()
    assert body["food_today"]["entries"] == 0
    assert body["nudges"]["no_food_today"] is True
