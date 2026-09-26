from datetime import date, timedelta

import pytest

PROFILE = {"height_cm": 180, "sex": "male", "date_of_birth": "1990-05-01", "timezone": "UTC"}


def _post(client, headers, day: str, weight: float, **extra) -> dict:
    res = client.post(
        "/body-entries",
        json={"measured_at": f"{day}T07:00:00Z", "weight_kg": weight, **extra},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


def _series(client, headers, metric: str, range_: str | None = None) -> dict:
    params = {"metric": metric} if range_ is None else {"metric": metric, "range": range_}
    return client.get("/series", params=params, headers=headers).json()


def test_weight_series_1m(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    start = date(2026, 2, 1)
    for i in range(29):  # Feb 1 .. Mar 1, losing 0.1 kg/day
        _post(client, headers, (start + timedelta(days=i)).isoformat(), 85 - 0.1 * i)
    res = client.get("/series", params={"metric": "weight_kg", "range": "1M"}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["label"] == "Weight" and body["unit"] == "kg"
    assert len(body["points"]) == 29
    assert len(body["trend"]) == 29
    assert body["points"][0] == {"date": "2026-02-01", "value": 85.0}
    assert -0.75 < body["weekly_rate"] < -0.4
    assert body["change"] < 0
    assert body["min"] == pytest.approx(82.2)
    assert body["max"] == 85.0


def test_range_filters_points(client, headers) -> None:
    _post(client, headers, "2025-12-01", 90)
    _post(client, headers, "2026-02-20", 85)
    body = _series(client, headers, "weight_kg", "1M")
    assert [p["date"] for p in body["points"]] == ["2026-02-20"]


def test_series_orders_backfilled_entries(client, headers) -> None:
    for day in ("2026-02-20", "2026-02-10", "2026-02-15"):
        _post(client, headers, day, 80)
    body = _series(client, headers, "weight_kg")
    assert [p["date"] for p in body["points"]] == ["2026-02-10", "2026-02-15", "2026-02-20"]


def test_series_reflects_deleted_entry(client, headers) -> None:
    _post(client, headers, "2026-02-10", 80)
    doomed = _post(client, headers, "2026-02-11", 99)
    client.delete(f"/body-entries/{doomed['id']}", headers=headers)
    body = _series(client, headers, "weight_kg")
    assert [p["value"] for p in body["points"]] == [80.0]


def test_bmi_uses_current_height(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    _post(client, headers, "2026-02-10", 81)
    assert _series(client, headers, "bmi")["points"][0]["value"] == 25.0
    client.put("/me/profile", json={**PROFILE, "height_cm": 190}, headers=headers)
    assert _series(client, headers, "bmi")["points"][0]["value"] == 22.4


def test_bmi_without_profile_is_empty(client, headers) -> None:
    _post(client, headers, "2026-02-10", 81)
    body = _series(client, headers, "bmi")
    assert body["points"] == [] and body["latest"] is None


def test_fat_and_lean_mass_derived(client, headers) -> None:
    _post(client, headers, "2026-02-10", 80, body_fat_pct=20)
    _post(client, headers, "2026-02-11", 80)  # no body fat -> ignored for fat mass
    fat = _series(client, headers, "fat_mass_kg")
    lean = _series(client, headers, "lean_mass_kg")
    assert [p["value"] for p in fat["points"]] == [16.0]
    assert [p["value"] for p in lean["points"]] == [64.0]


def test_navy_series(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    client.post(
        "/measurements",
        json={"measured_at": "2026-02-10T07:00:00Z", "waist_cm": 85, "neck_cm": 38},
        headers=headers,
    )
    body = _series(client, headers, "navy_body_fat_pct")
    assert body["points"][0]["value"] == pytest.approx(16.1, abs=0.15)


def test_profile_timezone_buckets_days(client, headers) -> None:
    client.put("/me/profile", json={**PROFILE, "timezone": "Asia/Jerusalem"}, headers=headers)
    for ts, w in (("2026-02-27T23:30:00Z", 80), ("2026-02-28T05:00:00Z", 82)):
        client.post("/body-entries", json={"measured_at": ts, "weight_kg": w}, headers=headers)
    body = _series(client, headers, "weight_kg")
    assert body["points"] == [{"date": "2026-02-28", "value": 81.0}]


def test_long_range_is_weekly(client, headers) -> None:
    _post(client, headers, "2024-12-03", 90)
    _post(client, headers, "2024-12-05", 88)
    _post(client, headers, "2026-02-26", 80)
    body = _series(client, headers, "weight_kg", "ALL")
    assert body["points"] == [
        {"date": "2024-12-02", "value": 89.0},
        {"date": "2026-02-23", "value": 80.0},
    ]
    assert all(date.fromisoformat(p["date"]).weekday() == 0 for p in body["trend"])


def test_unknown_metric_422(client, headers) -> None:
    res = client.get("/series", params={"metric": "shoe_size"}, headers=headers)
    assert res.status_code == 422


def test_empty_series(client, headers) -> None:
    body = _series(client, headers, "weight_kg")
    assert body["points"] == [] and body["weekly_rate"] is None and body["change"] is None
