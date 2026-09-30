"""USDA FoodData Central client (https://fdc.nal.usda.gov/api-guide).

Generic foods come from Foundation, SR Legacy and Survey (FNDDS); barcode lookups search
the Branded dataset by GTIN/UPC. Values are per 100 g for all of these data types.
"""

from typing import Any

import httpx

from app.food_sources import ExternalSource, FoodDraft
from app.food_sources.normalise import from_fdc_detail, from_fdc_search

BASE_URL = "https://api.nal.usda.gov/fdc/v1"
TIMEOUT_S = 8
GENERIC = ["Foundation", "SR Legacy", "Survey (FNDDS)"]


class FdcSource:
    name: ExternalSource = "usda"

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=TIMEOUT_S)
        self._client.base_url = httpx.URL(BASE_URL)
        self._client.params = self._client.params.set("api_key", api_key)

    def _search(self, query: str, data_types: list[str], size: int) -> list[dict[str, Any]]:
        res = self._client.post(
            "/foods/search", json={"query": query, "dataType": data_types, "pageSize": size}
        )
        res.raise_for_status()
        foods: list[dict[str, Any]] = res.json().get("foods") or []
        return foods

    def search(self, query: str, country: str) -> list[FoodDraft]:
        items = self._search(query.strip(), GENERIC, 15)
        return [d for d in map(from_fdc_search, items) if d is not None]

    def by_barcode(self, code: str) -> FoodDraft | None:
        if not code.isdigit():
            return None
        for item in self._search(code, ["Branded"], 5):
            if str(item.get("gtinUpc") or "").lstrip("0") == code.lstrip("0"):
                return from_fdc_search(item)
        return None

    def detail(self, source_ref: str) -> FoodDraft | None:
        if not source_ref.isdigit():
            return None
        res = self._client.get(f"/food/{source_ref}")
        if res.status_code == 404:
            return None
        res.raise_for_status()
        return from_fdc_detail(res.json())
