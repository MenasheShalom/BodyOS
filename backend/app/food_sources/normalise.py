"""Map Open Food Facts and USDA FoodData Central payloads onto `FoodDraft`.

Every function returns None for a food we can't use: no name, no energy and no macros to
derive it from, or values that fail the per-100 g plausibility checks.
"""

import re
from collections.abc import Iterable, Mapping
from typing import Any

from app.food_sources import FoodDraft, Serving
from app.nutrients import MACRO_KEYS, NUTRIENTS, Nutrients, validate_nutrients

KJ_PER_KCAL = 4.184
MAX_NAME = 200
_LIQUID_QUANTITY = re.compile(r"\d\s*(ml|cl|dl|l)\b", re.IGNORECASE)


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "."))
        except ValueError:
            return None
    return None


def _text(value: Any, limit: int = MAX_NAME) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] or None


def _derive_energy(n: Nutrients) -> None:
    if "energy_kcal" not in n and all(k in n for k in MACRO_KEYS):
        n["energy_kcal"] = 4 * n["protein_g"] + 4 * n["carbs_g"] + 9 * n["fat_g"]


def _finish(n: Nutrients) -> Nutrients | None:
    _derive_energy(n)
    try:
        return validate_nutrients(n, per_100g=True)
    except ValueError:
        return None


def _dedupe(servings: Iterable[Serving]) -> list[Serving]:
    seen: set[str] = set()
    out: list[Serving] = []
    for s in servings:
        if s["label"] not in seen and 0 < s["grams"] <= 5000:
            seen.add(s["label"])
            out.append(s)
    return out


# --- Open Food Facts -----------------------------------------------------------------------


def from_off(product: Mapping[str, Any]) -> FoodDraft | None:
    code = _text(product.get("code"), 14)
    name = next(
        filter(
            None,
            (_text(product.get(k)) for k in ("product_name_en", "product_name", "product_name_he")),
        ),
        None,
    )
    if not code or not name:
        return None
    raw = product.get("nutriments") or {}
    n: Nutrients = {}
    for nut in NUTRIENTS.values():
        value = _number(raw.get(nut.off_field))
        if value is not None:
            n[nut.key] = value * nut.off_scale
    if "energy_kcal" not in n:
        kj = _number(raw.get("energy-kj_100g"))
        kj = kj if kj is not None else _number(raw.get("energy_100g"))  # OFF energy is kJ
        if kj is not None:
            n["energy_kcal"] = kj / KJ_PER_KCAL
    nutrients = _finish(n)
    if nutrients is None:
        return None

    servings: list[Serving] = []
    grams = _number(product.get("serving_quantity"))
    label = _text(product.get("serving_size"), 100)
    if grams and grams > 0:
        servings.append({"label": label or f"{grams:g} g", "grams": grams})

    brand = _text((product.get("brands") or "").split(",")[0])
    unit = product.get("product_quantity_unit")
    quantity = product.get("quantity")
    is_liquid = unit == "ml" or (
        unit is None and isinstance(quantity, str) and bool(_LIQUID_QUANTITY.search(quantity))
    )
    countries = product.get("countries_tags") or []
    return FoodDraft(
        source="off",
        source_ref=code,
        name=name,
        brand=brand,
        barcode=code if code.isdigit() and 6 <= len(code) <= 14 else None,
        nutrients_per_100g=nutrients,
        servings=_dedupe(servings),
        is_liquid=is_liquid,
        countries=tuple(c for c in countries if isinstance(c, str)),
    )


# --- USDA FoodData Central -----------------------------------------------------------------


def _fdc_nutrients(values: Mapping[int, float]) -> Nutrients | None:
    n: Nutrients = {}
    for nut in NUTRIENTS.values():
        for usda_id in nut.usda_ids:
            if usda_id in values:
                n[nut.key] = values[usda_id]
                break
    return _finish(n)


def _fdc_name(food: Mapping[str, Any]) -> str | None:
    name = _text(food.get("description"))
    if name and name.isupper():  # branded descriptions are often SHOUTED
        name = name.capitalize()
    return name


def _fdc_draft(
    food: Mapping[str, Any], values: Mapping[int, float], servings: list[Serving]
) -> FoodDraft | None:
    name = _fdc_name(food)
    fdc_id = food.get("fdcId")
    nutrients = _fdc_nutrients(values)
    if not name or fdc_id is None or nutrients is None:
        return None
    gtin = _text(food.get("gtinUpc"), 14)
    size = _number(food.get("servingSize"))
    unit = str(food.get("servingSizeUnit") or "").lower()
    if size and unit in ("g", "grm", "ml", "mlt"):
        label = _text(food.get("householdServingFullText"), 100) or f"{size:g} {unit[0]}"
        servings = [*servings, {"label": label, "grams": size}]
    return FoodDraft(
        source="usda",
        source_ref=str(fdc_id),
        name=name,
        brand=_text(food.get("brandOwner")),
        barcode=gtin if gtin and gtin.isdigit() and len(gtin) >= 6 else None,
        nutrients_per_100g=nutrients,
        servings=_dedupe(servings),
    )


def from_fdc_search(item: Mapping[str, Any]) -> FoodDraft | None:
    values: dict[int, float] = {}
    for fn in item.get("foodNutrients") or []:
        nid, value = fn.get("nutrientId"), _number(fn.get("value"))
        if isinstance(nid, int) and value is not None:
            values.setdefault(nid, value)
    return _fdc_draft(item, values, [])


def _portion_label(p: Mapping[str, Any]) -> str | None:
    desc = _text(p.get("portionDescription"), 100)
    if desc and desc.lower() != "quantity not specified":
        return desc
    amount = _number(p.get("amount"))
    modifier = _text(p.get("modifier"), 90)
    unit = (p.get("measureUnit") or {}).get("name")
    what = modifier or (unit if unit and unit != "undetermined" else None)
    if amount is None or what is None:
        return None
    return f"{amount:g} {what}"


def from_fdc_detail(food: Mapping[str, Any]) -> FoodDraft | None:
    values: dict[int, float] = {}
    for fn in food.get("foodNutrients") or []:
        nid = (fn.get("nutrient") or {}).get("id")
        value = _number(fn.get("amount"))
        if isinstance(nid, int) and value is not None:
            values.setdefault(nid, value)
    servings: list[Serving] = []
    for p in food.get("foodPortions") or []:
        label, grams = _portion_label(p), _number(p.get("gramWeight"))
        if label and grams:
            servings.append({"label": label, "grams": grams})
    return _fdc_draft(food, values, servings)
