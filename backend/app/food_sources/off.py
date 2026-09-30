"""Open Food Facts client.

OFF asks apps to send a descriptive User-Agent and rate-limits search more tightly than
product reads (about 10 searches and 100 product reads per minute per IP at the time of
writing). We make one search call per submitted query and cache search and barcode
responses for 10 minutes. Text search uses the legacy `/cgi/search.pl` endpoint, which
supports full-text queries (including Hebrew); product reads use API v2.
"""

import time
from collections.abc import Callable

import httpx

from app.food_sources import ExternalSource, FoodDraft
from app.food_sources.normalise import from_off
from app.food_sources.ttl_cache import TTLCache

BASE_URL = "https://world.openfoodfacts.org"
TIMEOUT_S = 8
CACHE_TTL_S = 600
FIELDS = (
    "code,product_name,product_name_en,product_name_he,brands,countries_tags,quantity,"
    "product_quantity_unit,serving_size,serving_quantity,nutrition_data_per,nutriments"
)
NO_COUNTRY = "en:world"


class OffSource:
    name: ExternalSource = "off"

    def __init__(
        self,
        user_agent: str,
        client: httpx.Client | None = None,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client or httpx.Client(timeout=TIMEOUT_S)
        self._client.base_url = httpx.URL(BASE_URL)
        self._client.headers["User-Agent"] = user_agent
        self._searches: TTLCache[str, list[FoodDraft]] = TTLCache(CACHE_TTL_S, now=now)
        self._products: TTLCache[str, FoodDraft | None] = TTLCache(CACHE_TTL_S, now=now)

    def search(self, query: str, country: str) -> list[FoodDraft]:
        key = " ".join(query.lower().split())
        drafts = self._searches.get(key)
        if drafts is None:
            res = self._client.get(
                "/cgi/search.pl",
                params={
                    "search_terms": query.strip(),
                    "search_simple": 1,
                    "action": "process",
                    "json": 1,
                    "page_size": 20,
                    "fields": FIELDS,
                },
            )
            res.raise_for_status()
            products = res.json().get("products") or []
            drafts = [d for d in map(from_off, products) if d is not None]
            self._searches.set(key, drafts)
        if country == NO_COUNTRY:
            return list(drafts)
        # stable sort: products sold in the user's country first, otherwise OFF's order
        return sorted(drafts, key=lambda d: country not in d.countries)

    def by_barcode(self, code: str) -> FoodDraft | None:
        if not code.isdigit():
            return None
        cached = self._products.get(code)
        if cached is not None:
            return cached
        res = self._client.get(f"/api/v2/product/{code}", params={"fields": FIELDS})
        if res.status_code == 404:
            return None
        res.raise_for_status()
        data = res.json()
        draft = from_off(data["product"]) if data.get("status") == 1 else None
        if draft is not None:
            self._products.set(code, draft)
        return draft

    def detail(self, source_ref: str) -> FoodDraft | None:
        return self.by_barcode(source_ref)
