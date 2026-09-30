"""Record live Open Food Facts and USDA FoodData Central responses as test fixtures.

Run from backend/: USDA_API_KEY=<key or DEMO_KEY> python scripts/record_food_fixtures.py
Review the diff afterwards: product data changes over time, and the tests assert on it.
"""

import json
import os
import pathlib
from typing import Any

import httpx

OUT = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "food_sources"
OFF = "https://world.openfoodfacts.org"
FDC = "https://api.nal.usda.gov/fdc/v1"
USER_AGENT = os.environ.get("OFF_USER_AGENT", "BodyOS/0.2 (personal nutrition tracker)")
API_KEY = os.environ.get("USDA_API_KEY", "DEMO_KEY")
OFF_FIELDS = (
    "code,product_name,product_name_en,product_name_he,brands,countries_tags,quantity,"
    "product_quantity_unit,serving_size,serving_quantity,nutrition_data_per,nutriments"
)

# Barcodes chosen to exercise the normaliser: a Hebrew-named Israeli snack, a product that
# reports energy in kJ only, and a drink. Swap them if a product disappears from OFF.
OFF_PRODUCTS = {
    "off_product_hebrew.json": "7290000066318",
    "off_product_kj_only.json": "4000417025005",
    "off_product_liquid.json": "7290004131074",
    "off_not_found.json": "0000000000000",
}


def save(name: str, data: Any) -> None:
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("wrote", name)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=20, headers={"User-Agent": USER_AGENT}) as off:
        for name, code in OFF_PRODUCTS.items():
            res = off.get(f"{OFF}/api/v2/product/{code}", params={"fields": OFF_FIELDS})
            save(name, res.json())
        res = off.get(
            f"{OFF}/cgi/search.pl",
            params={
                "search_terms": "milk",
                "search_simple": 1,
                "action": "process",
                "json": 1,
                "page_size": 20,
                "fields": OFF_FIELDS,
            },
        )
        res.raise_for_status()
        save("off_search_milk.json", res.json())

    with httpx.Client(timeout=20, params={"api_key": API_KEY}) as fdc:
        generic = ["Foundation", "SR Legacy", "Survey (FNDDS)"]
        res = fdc.post(
            f"{FDC}/foods/search",
            json={"query": "chicken breast", "dataType": generic, "pageSize": 15},
        )
        res.raise_for_status()
        save("fdc_search_chicken.json", res.json())
        res = fdc.post(
            f"{FDC}/foods/search",
            json={"query": "0689544080145", "dataType": ["Branded"], "pageSize": 5},
        )
        res.raise_for_status()
        save("fdc_search_branded.json", res.json())
        for name, fdc_id in (
            ("fdc_detail_foundation.json", 2646170),
            ("fdc_detail_sr_legacy.json", 171705),
        ):
            res = fdc.get(f"{FDC}/food/{fdc_id}")
            res.raise_for_status()
            save(name, res.json())


if __name__ == "__main__":
    main()
