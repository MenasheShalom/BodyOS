from typing import Any

import psycopg
import pytest

from app.ai.factory import _build
from app.ai.prompts.body_fat import BodyFatOut, tidy_range
from tests.conftest import auth_for
from tests.test_ai_api import PROFILE
from tests.test_photos_api import _upload


@pytest.fixture
def setup(client, headers) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    client.post(
        "/body-entries",
        json={"measured_at": "2026-02-27T07:00:00+02:00", "weight_kg": 82.4},
        headers=headers,
    )


def photo(client, headers, storage, pose: str = "front", taken_at: str = "2026-02-28T07:00:00Z"):
    ticket, res = _upload(client, headers, storage, pose, taken_at)
    assert res.status_code == 201, res.text
    return ticket["photo_id"]


def estimate(client, headers, ids: list[str]) -> Any:
    return client.post("/ai/body-fat", json={"photo_ids": ids}, headers=headers)


def test_estimate_from_a_days_photos(client, headers, storage, user, db, ai, setup) -> None:
    side = photo(client, headers, storage, "side")
    front = photo(client, headers, storage, "front")
    res = estimate(client, headers, [side, front])
    assert res.status_code == 201, res.text
    body = res.json()
    assert (body["low_pct"], body["estimate_pct"], body["high_pct"]) == (17, 19, 21)
    assert body["taken_on"] == "2026-02-28"
    assert body["photo_ids"] == [front, side]  # front first
    assert "abdominal" in body["notes"]

    sent = _build("fake", None, "medium", 60, None, None).requests[-1]  # type: ignore[attr-defined]
    assert sent.feature == "body_fat" and len(sent.images) == 2
    assert "Sex: male" in sent.text and "82.4 kg" in sent.text
    assert "Photos, in order: front, side" in sent.text

    listed = client.get("/ai/body-fat", headers=headers).json()
    assert [e["id"] for e in listed] == [body["id"]]
    with psycopg.connect(db) as conn:
        assert conn.execute(
            "select feature, outcome from ai_usage where user_id = %s", (user,)
        ).fetchall() == [("body_fat", "ok")]


def test_photos_must_be_from_one_day(client, headers, storage, ai, setup) -> None:
    a = photo(client, headers, storage, "front", "2026-02-27T07:00:00Z")
    b = photo(client, headers, storage, "side", "2026-02-28T07:00:00Z")
    res = estimate(client, headers, [a, b])
    assert res.status_code == 422 and "same day" in res.json()["detail"]


def test_cannot_use_another_users_photo(client, headers, storage, make_user, ai, setup) -> None:
    other = auth_for(make_user())
    client.put("/me/profile", json=PROFILE, headers=other)
    theirs = photo(client, other, storage)
    assert estimate(client, headers, [theirs]).status_code == 404


def test_needs_ai_and_a_profile(client, headers, storage) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = estimate(client, headers, [photo(client, headers, storage)])
    assert res.json()["code"] == "ai_disabled"


def test_delete_estimate(client, headers, storage, make_user, ai, setup) -> None:
    created = estimate(client, headers, [photo(client, headers, storage)]).json()
    other = auth_for(make_user())
    assert client.delete(f"/ai/body-fat/{created['id']}", headers=other).status_code == 404
    assert client.delete(f"/ai/body-fat/{created['id']}", headers=headers).status_code == 204
    assert client.get("/ai/body-fat", headers=headers).json() == []


@pytest.mark.parametrize(
    ("raw", "tidy"),
    [
        ((17, 19, 21), (17, 19, 21)),
        ((21, 19, 17), (17, 19, 21)),  # out of order
        ((10, 18, 30), (14, 18, 22)),  # too wide: 8 points around the estimate
        ((3, 4, 12), (3, 4, 8)),  # clamped at the floor
    ],
)
def test_tidy_range(raw: tuple[float, float, float], tidy: tuple[float, float, float]) -> None:
    out = BodyFatOut(low_pct=raw[0], estimate_pct=raw[1], high_pct=raw[2], notes="")
    assert tidy_range(out) == tidy


def test_estimates_appear_on_trends_as_ranges(client, headers, storage, ai, setup) -> None:
    estimate(client, headers, [photo(client, headers, storage)])
    res = client.get(
        "/series", params={"metric": "ai_body_fat_pct", "range": "1M"}, headers=headers
    ).json()
    assert res["label"] == "Body fat (AI photo)"
    assert res["points"] == [{"date": "2026-02-28", "value": 19}]
    assert res["band"] == [{"date": "2026-02-28", "low": 17, "high": 21}]
    assert res["trend"] == [] and res["weekly_rate"] is None and res["latest"] == 19
    weight = client.get("/series", params={"metric": "weight_kg"}, headers=headers).json()
    assert weight["band"] == []
