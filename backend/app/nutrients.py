from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Nutrients = dict[str, float]


@dataclass(frozen=True)
class Nutrient:
    key: str
    label: str
    unit: str
    kind: Literal["macro", "micro"]
    usda_ids: tuple[int, ...]  # first match wins
    off_field: str
    off_scale: float  # OFF stores grams per 100 g; multiply into our unit
    max_per_100g: float


def _n(
    key: str,
    label: str,
    unit: str,
    kind: Literal["macro", "micro"],
    usda: tuple[int, ...],
    off: str,
    scale: float,
    cap: float,
) -> Nutrient:
    return Nutrient(key, label, unit, kind, usda, off, scale, cap)


NUTRIENTS: dict[str, Nutrient] = {
    n.key: n
    for n in (
        _n(
            "energy_kcal",
            "Calories",
            "kcal",
            "macro",
            (1008, 2047, 2048),
            "energy-kcal_100g",
            1,
            900,
        ),
        _n("protein_g", "Protein", "g", "macro", (1003,), "proteins_100g", 1, 100),
        _n("carbs_g", "Carbs", "g", "macro", (1005,), "carbohydrates_100g", 1, 100),
        _n("fat_g", "Fat", "g", "macro", (1004,), "fat_100g", 1, 100),
        _n("fiber_g", "Fibre", "g", "macro", (1079,), "fiber_100g", 1, 100),
        _n("sugar_g", "Sugar", "g", "macro", (2000,), "sugars_100g", 1, 100),
        _n("sat_fat_g", "Saturated fat", "g", "macro", (1258,), "saturated-fat_100g", 1, 100),
        _n("sodium_mg", "Sodium", "mg", "micro", (1093,), "sodium_100g", 1e3, 40_000),
        _n("potassium_mg", "Potassium", "mg", "micro", (1092,), "potassium_100g", 1e3, 20_000),
        _n("calcium_mg", "Calcium", "mg", "micro", (1087,), "calcium_100g", 1e3, 10_000),
        _n("iron_mg", "Iron", "mg", "micro", (1089,), "iron_100g", 1e3, 500),
        _n("magnesium_mg", "Magnesium", "mg", "micro", (1090,), "magnesium_100g", 1e3, 5_000),
        _n("zinc_mg", "Zinc", "mg", "micro", (1095,), "zinc_100g", 1e3, 500),
        _n("vit_d_mcg", "Vitamin D", "µg", "micro", (1114,), "vitamin-d_100g", 1e6, 1_000),
        _n("vit_b12_mcg", "Vitamin B12", "µg", "micro", (1178,), "vitamin-b12_100g", 1e6, 1_000),
        _n("vit_c_mg", "Vitamin C", "mg", "micro", (1162,), "vitamin-c_100g", 1e3, 5_000),
        _n("vit_a_mcg", "Vitamin A", "µg", "micro", (1106,), "vitamin-a_100g", 1e6, 50_000),
        _n("folate_mcg", "Folate", "µg", "micro", (1190,), "folates_100g", 1e6, 10_000),
    )
}
MACRO_KEYS = ("protein_g", "carbs_g", "fat_g")


def validate_nutrients(n: Mapping[str, float], *, per_100g: bool) -> Nutrients:
    unknown = set(n) - NUTRIENTS.keys()
    if unknown:
        raise ValueError(f"Unknown nutrients: {', '.join(sorted(unknown))}")
    if "energy_kcal" not in n:
        raise ValueError("Calories are required")
    out: Nutrients = {}
    for key, value in n.items():
        if value < 0:
            raise ValueError(f"{NUTRIENTS[key].label} can't be negative")
        if per_100g and value > NUTRIENTS[key].max_per_100g:
            raise ValueError(f"{NUTRIENTS[key].label} is too high per 100 g")
        out[key] = float(value)
    if per_100g and sum(out.get(k, 0) for k in MACRO_KEYS) > 105:
        raise ValueError("Protein, carbs and fat add up to more than 100 g per 100 g")
    return out
