from datetime import UTC, datetime
from typing import Any

import pytest

from app.clock import get_now
from tests.conftest import auth_for
from tests.test_food_log_api import HUMMUS, PROFILE


@pytest.fixture
def food(client, headers) -> dict[str, Any]:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    return client.post("/foods", json=HUMMUS, headers=headers).json()


def log(client, headers, food_id: str, eaten_at: str, meal: str = "breakfast") -> dict[str, Any]:
    body = {"food_id": food_id, "grams": 60, "meal": meal, "eaten_at": eaten_at}
    res = client.post("/food-log", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def copy(client, headers, **body: Any) -> Any:
    return client.post("/food-log/copy", json=body, headers=headers)


def day(client, headers, d: str) -> list[dict[str, Any]]:
    return client.get("/food-log", params={"day": d}, headers=headers).json()["entries"]


def test_copy_whole_day_keeps_local_times_and_snapshots(client, headers, food) -> None:
    log(client, headers, food["id"], "2026-02-27T08:00:00+02:00")
    log(client, headers, food["id"], "2026-02-27T13:00:00+02:00", meal="lunch")
    res = copy(client, headers, from_day="2026-02-27", to_day="2026-02-28")
    assert res.status_code == 201
    copies = res.json()
    assert [c["eaten_at"] for c in copies] == ["2026-02-28T06:00:00Z", "2026-02-28T11:00:00Z"]
    assert [c["meal"] for c in copies] == ["breakfast", "lunch"]
    assert copies[0]["nutrients"] == {
        "energy_kcal": 162.0,
        "protein_g": 4.2,
        "fat_g": 12.6,
        "vit_d_mcg": 0.0,
    }
    assert copies[0]["meal_ref"] == copies[1]["meal_ref"] is not None
    assert len(day(client, headers, "2026-02-28")) == 2
    assert len(day(client, headers, "2026-02-27")) == 2  # originals untouched


def test_copy_one_meal_into_another(client, headers, food) -> None:
    log(client, headers, food["id"], "2026-02-27T08:00:00+02:00")
    log(client, headers, food["id"], "2026-02-27T13:00:00+02:00", meal="lunch")
    res = copy(
        client,
        headers,
        from_day="2026-02-27",
        to_day="2026-02-28",
        meal="breakfast",
        to_meal="snack",
    )
    assert [c["meal"] for c in res.json()] == ["snack"]


def test_copy_into_today_clamps_future_times(client, headers, food) -> None:
    # FIXED_NOW is 2026-03-01 12:00 UTC (14:00 in Jerusalem); dinner at 19:00 hasn't happened yet
    log(client, headers, food["id"], "2026-02-28T19:00:00+02:00", meal="dinner")
    [copied] = copy(client, headers, from_day="2026-02-28", to_day="2026-03-01").json()
    assert copied["eaten_at"] == "2026-03-01T12:00:00Z"


def test_copy_across_dst_uses_local_time(client, headers, food, app_under_test) -> None:
    app_under_test.dependency_overrides[get_now] = lambda: datetime(2026, 4, 1, 12, tzinfo=UTC)
    log(client, headers, food["id"], "2026-03-26T08:00:00+02:00")  # before DST (UTC+2)
    [copied] = copy(client, headers, from_day="2026-03-26", to_day="2026-03-28").json()
    assert copied["eaten_at"] == "2026-03-28T05:00:00Z"  # 08:00 at UTC+3


def test_copy_empty_meal(client, headers, food) -> None:
    res = copy(client, headers, from_day="2026-02-20", to_day="2026-02-28", meal="dinner")
    assert res.status_code == 201 and res.json() == []


def test_copy_into_future_422(client, headers, food) -> None:
    assert copy(client, headers, from_day="2026-02-28", to_day="2026-03-02").status_code == 422


def test_to_meal_needs_meal_422(client, headers, food) -> None:
    res = copy(client, headers, from_day="2026-02-27", to_day="2026-02-28", to_meal="lunch")
    assert res.status_code == 422


def test_copy_only_my_entries(client, headers, make_user, food) -> None:
    log(client, headers, food["id"], "2026-02-27T08:00:00+02:00")
    other = auth_for(make_user())
    assert copy(client, other, from_day="2026-02-27", to_day="2026-02-28").json() == []
