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
    assert body["nudges"] == {"days_since_weigh_in": None, "days_since_photo": None}


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
