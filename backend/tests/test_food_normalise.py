import json
import pathlib
from typing import Any

import pytest

from app.food_sources.normalise import from_fdc_detail, from_fdc_search, from_off

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "food_sources"


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def test_off_hebrew_name_and_barcode() -> None:
    draft = from_off(load("off_product_hebrew.json")["product"])
    assert draft is not None
    assert draft.name == "במבה"
    assert draft.brand == "אסם"
    assert draft.barcode == draft.source_ref == "7290000066318"
    assert draft.source == "off"
    assert "en:israel" in draft.countries
    assert draft.nutrients_per_100g["energy_kcal"] == 534


def test_off_kj_only_converts_to_kcal() -> None:
    draft = from_off(load("off_product_kj_only.json")["product"])
    assert draft is not None
    assert draft.nutrients_per_100g["energy_kcal"] == pytest.approx(2380 / 4.184, abs=0.5)


def test_off_liquid_flagged() -> None:
    liquid = from_off(load("off_product_liquid.json")["product"])
    solid = from_off(load("off_product_hebrew.json")["product"])
    assert liquid is not None and liquid.is_liquid
    assert solid is not None and not solid.is_liquid


def test_off_micros_scaled_to_units() -> None:
    draft = from_off(load("off_product_liquid.json")["product"])
    assert draft is not None
    n = draft.nutrients_per_100g
    assert n["sodium_mg"] == pytest.approx(44)
    assert n["calcium_mg"] == pytest.approx(120)
    assert n["vit_d_mcg"] == pytest.approx(0.5)
    assert "iron_mg" not in n


def test_off_serving_from_serving_quantity() -> None:
    hebrew = from_off(load("off_product_hebrew.json")["product"])
    assert hebrew is not None and hebrew.servings == [{"label": "25 g", "grams": 25.0}]
    kj_only = from_off(load("off_product_kj_only.json")["product"])
    assert kj_only is not None and kj_only.servings == []


def test_off_missing_kcal_derived_from_macros() -> None:
    draft = from_off(
        {
            "code": "1234567",
            "product_name": "Oats",
            "nutriments": {"proteins_100g": 13, "carbohydrates_100g": 60, "fat_100g": 7},
        }
    )
    assert draft is not None
    assert draft.nutrients_per_100g["energy_kcal"] == pytest.approx(4 * 13 + 4 * 60 + 9 * 7)


def test_off_no_energy_and_no_macros_returns_none() -> None:
    assert from_off({"code": "1234567", "product_name": "X", "nutriments": {}}) is None


def test_off_implausible_returns_none() -> None:
    product = {"code": "1234567", "product_name": "X", "nutriments": {"energy-kcal_100g": 2000}}
    assert from_off(product) is None


def test_off_nameless_returns_none() -> None:
    products = load("off_search_milk.json")["products"]
    assert from_off(products[2]) is None


def test_off_ignores_non_numeric_values() -> None:
    draft = from_off(
        {
            "code": "1234567",
            "product_name": "X",
            "nutriments": {"energy-kcal_100g": 100, "proteins_100g": "abc", "fat_100g": True},
        }
    )
    assert draft is not None
    assert draft.nutrients_per_100g == {"energy_kcal": 100}


def test_name_prefers_english_then_default_then_hebrew() -> None:
    base = {"code": "1234567", "nutriments": {"energy-kcal_100g": 100}}
    both = from_off({**base, "product_name_en": "Milk", "product_name": "חלב"})
    default = from_off({**base, "product_name": "Lait", "product_name_he": "חלב"})
    hebrew = from_off({**base, "product_name": "", "product_name_he": "חלב"})
    assert both is not None and both.name == "Milk"
    assert default is not None and default.name == "Lait"
    assert hebrew is not None and hebrew.name == "חלב"


def test_names_trimmed_to_200() -> None:
    draft = from_off(
        {"code": "1234567", "product_name": "  " + "x" * 300, "nutriments": {"energy-kcal_100g": 1}}
    )
    assert draft is not None and len(draft.name) == 200


def test_fdc_search_item_maps_by_nutrient_id() -> None:
    draft = from_fdc_search(load("fdc_search_chicken.json")["foods"][0])
    assert draft is not None
    assert draft.source == "usda" and draft.source_ref == "171477"
    assert draft.barcode is None
    n = draft.nutrients_per_100g
    assert n["energy_kcal"] == 165
    assert n["protein_g"] == 31
    assert n["sodium_mg"] == 74
    assert n["vit_b12_mcg"] == 0.34


def test_fdc_search_atwater_energy() -> None:
    draft = from_fdc_search(load("fdc_search_chicken.json")["foods"][1])
    assert draft is not None and draft.nutrients_per_100g["energy_kcal"] == 107


def test_fdc_detail_atwater_fallback_and_missing_amount() -> None:
    draft = from_fdc_detail(load("fdc_detail_foundation.json"))
    assert draft is not None
    n = draft.nutrients_per_100g
    assert n["energy_kcal"] == 107  # general factors before specific
    assert n["protein_g"] == 22.5
    assert n["iron_mg"] == 0.33


def test_fdc_detail_portions_become_servings() -> None:
    draft = from_fdc_detail(load("fdc_detail_sr_legacy.json"))
    assert draft is not None
    assert draft.servings == [
        {"label": "1 cup, cubes", "grams": 150.0},
        {"label": "0.5 fruit, without skin and seed", "grams": 68.0},
    ]
    assert draft.nutrients_per_100g["folate_mcg"] == 81


def test_fdc_branded_keeps_barcode_brand_and_serving() -> None:
    draft = from_fdc_search(load("fdc_search_branded.json")["foods"][0])
    assert draft is not None
    assert draft.barcode == "0689544080145"
    assert draft.brand == "Fage"
    assert draft.servings == [{"label": "1 container", "grams": 170.0}]
