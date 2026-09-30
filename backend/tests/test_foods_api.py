from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.food_sources import get_food_sources
from app.food_sources.fake import DEMO_OFF, DEMO_USDA, FakeFoodSource
from tests.conftest import auth_for

SHAKE = {
    "name": "Protein shake",
    "brand": "Home",
    "servings": [{"label": "1 scoop", "grams": 30}],
    "nutrients_per_serving": {"energy_kcal": 120, "protein_g": 24},
    "serving_grams": 30,
}


@pytest.fixture
def sources(app_under_test: Any) -> Iterator[dict[str, FakeFoodSource]]:
    fakes = {
        "off": FakeFoodSource("off", list(DEMO_OFF)),
        "usda": FakeFoodSource("usda", list(DEMO_USDA)),
    }
    app_under_test.dependency_overrides[get_food_sources] = lambda: fakes
    yield fakes


def create_food(client, headers, body: dict[str, Any] | None = None) -> dict[str, Any]:
    res = client.post("/foods", json=body or SHAKE, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def test_search_returns_local_and_external(client, headers, sources) -> None:
    create_food(client, headers, {**SHAKE, "name": "Chicken shake"})
    res = client.get("/foods/search", params={"q": "chicken"}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert [f["name"] for f in body["local"]] == ["Chicken shake"]
    assert body["local"][0]["is_own"] is True
    assert body["external"][0]["source"] == "usda"
    assert body["external"][0]["id"] is None
    assert body["sources_failed"] == []


def test_search_local_only(client, headers, sources) -> None:
    res = client.get("/foods/search", params={"q": "hummus", "external": "false"}, headers=headers)
    assert res.json() == {"local": [], "external": [], "sources_failed": []}
    assert sources["off"].calls == 0 and sources["usda"].calls == 0


def test_search_survives_failing_source(client, headers, sources) -> None:
    sources["off"].fail = True
    res = client.get("/foods/search", params={"q": "avocado"}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["sources_failed"] == ["off"]
    assert [f["source"] for f in body["external"]] == ["usda"]


def test_search_dedupes_cached_external(client, headers, sources) -> None:
    imported = client.post(
        "/foods/import", json={"source": "off", "source_ref": "7290000000017"}, headers=headers
    ).json()
    body = client.get("/foods/search", params={"q": "hummus"}, headers=headers).json()
    assert [f["id"] for f in body["local"]] == [imported["id"]]
    assert body["local"][0]["is_own"] is False
    assert body["external"] == []


def test_search_requires_three_chars(client, headers, sources) -> None:
    assert client.get("/foods/search", params={"q": "ab"}, headers=headers).status_code == 422


def test_search_escapes_like_wildcards(client, headers, sources) -> None:
    create_food(client, headers)
    body = client.get("/foods/search", params={"q": "%%%", "external": "false"}, headers=headers)
    assert body.json()["local"] == []


def test_search_hebrew_query(client, headers, sources) -> None:
    body = client.get("/foods/search", params={"q": "במבה"}, headers=headers).json()
    assert [f["name"] for f in body["external"]] == ["במבה"]
    client.post(
        "/foods/import", json={"source": "off", "source_ref": "7290000066318"}, headers=headers
    )
    body = client.get("/foods/search", params={"q": "במבה"}, headers=headers).json()
    assert [f["name"] for f in body["local"]] == ["במבה"] and body["external"] == []


def test_search_matches_brand(client, headers, sources) -> None:
    body = client.get("/foods/search", params={"q": "תנובה"}, headers=headers).json()
    assert [f["name"] for f in body["external"]] == ["Milk 3% fat"]


def test_barcode_imports_then_hits_cache(client, headers, sources) -> None:
    first = client.get("/foods/barcode/7290000000017", headers=headers)
    assert first.status_code == 200
    assert first.json()["id"] and first.json()["name"] == "Demo hummus"
    calls = sources["off"].calls
    second = client.get("/foods/barcode/7290000000017", headers=headers)
    assert second.json()["id"] == first.json()["id"]
    assert sources["off"].calls == calls


def test_barcode_prefers_own_food(client, headers, sources) -> None:
    own = create_food(client, headers, {**SHAKE, "barcode": "7290000000017"})
    res = client.get("/foods/barcode/7290000000017", headers=headers)
    assert res.json()["id"] == own["id"]


def test_barcode_falls_back_to_usda(client, headers, sources) -> None:
    sources["usda"].drafts[0] = replace(DEMO_USDA[0], barcode="0012345678905")
    res = client.get("/foods/barcode/0012345678905", headers=headers)
    assert res.status_code == 200 and res.json()["source"] == "usda"


def test_barcode_not_found_404(client, headers, sources) -> None:
    assert client.get("/foods/barcode/1111111111111", headers=headers).status_code == 404


def test_barcode_sources_down_503(client, headers, sources) -> None:
    sources["off"].fail = sources["usda"].fail = True
    assert client.get("/foods/barcode/1111111111111", headers=headers).status_code == 503


def test_barcode_invalid_422(client, headers, sources) -> None:
    assert client.get("/foods/barcode/abc123", headers=headers).status_code == 422


def test_import_is_idempotent(client, headers, db, sources) -> None:
    body = {"source": "usda", "source_ref": "171705"}
    a = client.post("/foods/import", json=body, headers=headers).json()
    b = client.post("/foods/import", json=body, headers=headers).json()
    assert a["id"] == b["id"]
    assert a["servings"] == [{"label": "1 cup, cubes", "grams": 150.0}]
    with psycopg.connect(db) as conn:
        assert conn.execute("select count(*) from foods").fetchone() == (1,)


def test_import_unknown_404(client, headers, sources) -> None:
    res = client.post("/foods/import", json={"source": "off", "source_ref": "999"}, headers=headers)
    assert res.status_code == 404


def test_import_source_down_503(client, headers, sources) -> None:
    sources["usda"].fail = True
    res = client.post(
        "/foods/import", json={"source": "usda", "source_ref": "171705"}, headers=headers
    )
    assert res.status_code == 503


def test_get_food(client, headers, sources) -> None:
    food = create_food(client, headers)
    res = client.get(f"/foods/{food['id']}", headers=headers)
    assert res.status_code == 200 and res.json()["name"] == "Protein shake"


def test_custom_food_per_serving_converted(client, headers, sources) -> None:
    food = create_food(client, headers)
    assert food["nutrients_per_100g"] == {"energy_kcal": 400.0, "protein_g": 80.0}
    assert food["source"] == "custom" and food["is_own"] is True


def test_custom_food_per_100g(client, headers, sources) -> None:
    body = {"name": "Rice", "nutrients_per_100g": {"energy_kcal": 130, "carbs_g": 28}}
    assert create_food(client, headers, body)["nutrients_per_100g"]["carbs_g"] == 28


@pytest.mark.parametrize(
    "patch",
    [
        {"nutrients_per_serving": {"energy_kcal": 400}, "serving_grams": 30},  # 1333 kcal/100 g
        {"nutrients_per_serving": {"energy_kcal": 100, "caffeine_mg": 3}},
        {"nutrients_per_serving": {"protein_g": 3}},
        {"nutrients_per_100g": {"energy_kcal": 100}},  # both bases
        {"serving_grams": None},
        {"barcode": "12ab"},
        {"name": " "},
    ],
)
def test_custom_food_validation_422(client, headers, sources, patch: dict[str, Any]) -> None:
    res = client.post("/foods", json={**SHAKE, **patch}, headers=headers)
    assert res.status_code == 422, res.text


def test_update_custom_food(client, headers, sources) -> None:
    food = create_food(client, headers)
    body = {**SHAKE, "name": "Shake v2", "nutrients_per_serving": {"energy_kcal": 150}}
    res = client.put(f"/foods/{food['id']}", json=body, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "Shake v2"
    assert res.json()["nutrients_per_100g"] == {"energy_kcal": 500.0}


def test_custom_food_isolation(client, headers, make_user, sources) -> None:
    food = create_food(client, headers)
    other = auth_for(make_user())
    assert client.get(f"/foods/{food['id']}", headers=other).status_code == 404
    assert client.put(f"/foods/{food['id']}", json=SHAKE, headers=other).status_code == 404
    assert client.delete(f"/foods/{food['id']}", headers=other).status_code == 404
    body = client.get("/foods/search", params={"q": "shake"}, headers=other).json()
    assert body["local"] == []
    assert client.get("/foods/mine", headers=other).json() == []


def test_cannot_change_shared_food(client, headers, sources) -> None:
    shared = client.post(
        "/foods/import", json={"source": "off", "source_ref": "7290000000017"}, headers=headers
    ).json()
    assert client.put(f"/foods/{shared['id']}", json=SHAKE, headers=headers).status_code == 404
    assert client.delete(f"/foods/{shared['id']}", headers=headers).status_code == 404


def test_delete_unlogged_food(client, headers, db, sources) -> None:
    food = create_food(client, headers)
    assert client.delete(f"/foods/{food['id']}", headers=headers).status_code == 204
    with psycopg.connect(db) as conn:
        assert conn.execute("select count(*) from foods").fetchone() == (0,)


def test_delete_archives_when_logged(client, headers, user, db, sources) -> None:
    food = create_food(client, headers)
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into food_log (user_id, eaten_at, meal, food_id, name, grams, nutrients)"
            " values (%s, now(), 'lunch', %s, 'Protein shake', 30, %s)",
            (user, food["id"], Jsonb({"energy_kcal": 120})),
        )
    assert client.delete(f"/foods/{food['id']}", headers=headers).status_code == 204
    with psycopg.connect(db) as conn:
        assert conn.execute("select archived from foods").fetchone() == (True,)
    assert client.get("/foods/mine", headers=headers).json() == []
    body = client.get("/foods/search", params={"q": "shake"}, headers=headers).json()
    assert body["local"] == []


def test_mine_lists_own_custom_foods_by_name(client, headers, sources) -> None:
    create_food(client, headers, {**SHAKE, "name": "Zucchini bake"})
    create_food(client, headers, {**SHAKE, "name": "Apple pie"})
    names = [f["name"] for f in client.get("/foods/mine", headers=headers).json()]
    assert names == ["Apple pie", "Zucchini bake"]


def test_foods_require_auth(client, sources) -> None:
    assert client.get("/foods/search", params={"q": "milk"}).status_code == 401
