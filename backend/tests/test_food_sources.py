import json
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.food_sources import get_food_sources
from app.food_sources.fake import FakeFoodSource
from app.food_sources.fdc import FdcSource
from app.food_sources.off import OffSource
from app.food_sources.ttl_cache import TTLCache
from tests.test_food_normalise import load


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def recording(handler: Any) -> tuple[httpx.Client, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)  # type: ignore[no-any-return]

    return httpx.Client(transport=httpx.MockTransport(_handle)), seen


def off_source(handler: Any, clock: Clock | None = None) -> tuple[OffSource, list[httpx.Request]]:
    client, seen = recording(handler)
    source = OffSource("BodyOS/test (x@example.com)", client=client, now=clock or Clock())
    return source, seen


def test_off_search_sends_user_agent_and_ranks_country_first() -> None:
    source, seen = off_source(lambda r: httpx.Response(200, json=load("off_search_milk.json")))
    results = source.search("milk", "en:israel")
    assert len(seen) == 1
    assert seen[0].headers["User-Agent"] == "BodyOS/test (x@example.com)"
    assert seen[0].url.params["search_terms"] == "milk"
    # the nameless product is dropped; the Israeli milk is ranked before the French one
    assert [d.source_ref for d in results] == ["7290004131074", "3274080005003"]


def test_off_search_world_keeps_source_order() -> None:
    source, _ = off_source(lambda r: httpx.Response(200, json=load("off_search_milk.json")))
    assert [d.source_ref for d in source.search("milk", "en:world")] == [
        "3274080005003",
        "7290004131074",
    ]


def test_off_search_cached_for_ten_minutes() -> None:
    clock = Clock()
    source, seen = off_source(
        lambda r: httpx.Response(200, json=load("off_search_milk.json")), clock
    )
    source.search("Milk ", "en:israel")
    source.search("milk", "en:world")  # same query, different ranking: still cached
    assert len(seen) == 1
    clock.t += 601
    source.search("milk", "en:israel")
    assert len(seen) == 2


def test_off_barcode_found_and_cached() -> None:
    source, seen = off_source(lambda r: httpx.Response(200, json=load("off_product_hebrew.json")))
    draft = source.by_barcode("7290000066318")
    assert draft is not None and draft.name == "במבה"
    assert seen[0].url.path == "/api/v2/product/7290000066318"
    assert source.detail("7290000066318") == draft
    assert len(seen) == 1


def test_off_barcode_not_found_returns_none() -> None:
    source, _ = off_source(lambda r: httpx.Response(404, json=load("off_not_found.json")))
    assert source.by_barcode("0000000000000") is None


def test_off_http_error_raises() -> None:
    source, _ = off_source(lambda r: httpx.Response(503, text="busy"))
    with pytest.raises(httpx.HTTPStatusError):
        source.search("milk", "en:israel")


def fdc_source(handler: Any) -> tuple[FdcSource, list[httpx.Request]]:
    client, seen = recording(handler)
    return FdcSource("test-key", client=client), seen


def test_fdc_search_posts_datatypes_and_key() -> None:
    source, seen = fdc_source(lambda r: httpx.Response(200, json=load("fdc_search_chicken.json")))
    results = source.search("chicken", "en:israel")
    assert [d.source_ref for d in results] == ["171477", "2646170"]
    req = seen[0]
    assert req.method == "POST" and req.url.path == "/fdc/v1/foods/search"
    assert req.url.params["api_key"] == "test-key"
    body = json.loads(req.content)
    assert body == {
        "query": "chicken",
        "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)"],
        "pageSize": 15,
    }


def test_fdc_barcode_uses_branded_gtin() -> None:
    source, seen = fdc_source(lambda r: httpx.Response(200, json=load("fdc_search_branded.json")))
    draft = source.by_barcode("689544080145")  # UPC-A without the leading zero
    assert draft is not None and draft.source_ref == "2099999"
    assert json.loads(seen[0].content)["dataType"] == ["Branded"]
    assert source.by_barcode("123456789") is None


def test_detail_fetches_single_food() -> None:
    source, seen = fdc_source(lambda r: httpx.Response(200, json=load("fdc_detail_sr_legacy.json")))
    draft = source.detail("171705")
    assert draft is not None and draft.name.startswith("Avocados")
    assert seen[0].url.path == "/fdc/v1/food/171705"


def test_detail_rejects_non_numeric_ref() -> None:
    source, seen = fdc_source(lambda r: httpx.Response(500))
    assert source.detail("../secrets") is None
    assert seen == []


def test_ttl_cache_evicts_oldest() -> None:
    clock = Clock()
    cache: TTLCache[str, int] = TTLCache(ttl_s=10, max_items=2, now=clock)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    assert cache.get("a") is None and cache.get("c") == 3
    clock.t += 11
    assert cache.get("c") is None


def test_fake_sources_selected_by_setting() -> None:
    sources = get_food_sources(Settings(food_sources="fake"))
    assert set(sources) == {"off", "usda"}
    assert all(isinstance(s, FakeFoodSource) for s in sources.values())
    hummus = sources["off"].by_barcode("7290000000017")
    assert hummus is not None and hummus.name == "Demo hummus"


def test_live_sources_are_reused_across_requests() -> None:
    settings = Settings(food_sources="live", usda_api_key="k")
    first = get_food_sources(settings)
    assert isinstance(first["off"], OffSource) and isinstance(first["usda"], FdcSource)
    assert get_food_sources(settings)["off"] is first["off"]
