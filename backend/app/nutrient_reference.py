"""Daily reference intakes for the micronutrients view (spec §6.6).

Values are the US Dietary Reference Intakes for adults: the RDA where one exists, otherwise
the Adequate Intake (National Academies, DRI summary tables; potassium and sodium per the
2019 update). Sodium uses the 2,300 mg chronic-disease risk reduction intake as an upper
limit, and saturated fat the common guidance of under 10% of calories.
"""

from typing import Literal

from app.calculations.body import Sex

Kind = Literal["target", "limit"]

# Age bands: 19–30, 31–50, 51–70, 71+ (younger adults use the first band).
_BANDS = (30, 50, 70)

_BY_BAND: dict[str, dict[Sex, tuple[float, float, float, float]]] = {
    "potassium_mg": {"male": (3400,) * 4, "female": (2600,) * 4},
    "calcium_mg": {"male": (1000, 1000, 1000, 1200), "female": (1000, 1000, 1200, 1200)},
    "iron_mg": {"male": (8,) * 4, "female": (18, 18, 8, 8)},
    "magnesium_mg": {"male": (400, 420, 420, 420), "female": (310, 320, 320, 320)},
    "zinc_mg": {"male": (11,) * 4, "female": (8,) * 4},
    "vit_d_mcg": {"male": (15, 15, 15, 20), "female": (15, 15, 15, 20)},
    "vit_b12_mcg": {"male": (2.4,) * 4, "female": (2.4,) * 4},
    "vit_c_mg": {"male": (90,) * 4, "female": (75,) * 4},
    "vit_a_mcg": {"male": (900,) * 4, "female": (700,) * 4},
    "folate_mcg": {"male": (400,) * 4, "female": (400,) * 4},
}

SODIUM_LIMIT_MG = 2300
SAT_FAT_SHARE = 0.10  # of calories
FIBRE_PER_1000_KCAL = 14

# Shown in the micronutrients view, in this order. Calories and macros live on the day summary.
SHOWN = (
    "fiber_g",
    "sugar_g",
    "sat_fat_g",
    "sodium_mg",
    "potassium_mg",
    "calcium_mg",
    "iron_mg",
    "magnesium_mg",
    "zinc_mg",
    "vit_d_mcg",
    "vit_b12_mcg",
    "vit_c_mg",
    "vit_a_mcg",
    "folate_mcg",
)


def _band(age: int) -> int:
    return sum(age > limit for limit in _BANDS)


def reference(
    sex: Sex, age: int, key: str, avg_kcal: float, fibre_target: float | None
) -> tuple[float, Kind] | None:
    """The daily reference for a nutrient and whether it's a target or an upper limit."""
    if key == "fiber_g":
        return (fibre_target or FIBRE_PER_1000_KCAL * avg_kcal / 1000), "target"
    if key == "sodium_mg":
        return SODIUM_LIMIT_MG, "limit"
    if key == "sat_fat_g":
        return SAT_FAT_SHARE * avg_kcal / 9, "limit"
    if key in _BY_BAND:
        return _BY_BAND[key][sex][_band(age)], "target"
    return None  # e.g. sugar: no reference intake
