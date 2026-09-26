import math
from typing import Literal

Sex = Literal["male", "female"]


def bmi(weight_kg: float, height_cm: float) -> float:
    meters = height_cm / 100
    return round(weight_kg / (meters * meters), 1)


def fat_mass_kg(weight_kg: float, body_fat_pct: float) -> float:
    return round(weight_kg * body_fat_pct / 100, 2)


def lean_mass_kg(weight_kg: float, body_fat_pct: float) -> float:
    return round(weight_kg - weight_kg * body_fat_pct / 100, 2)


def navy_body_fat_pct(
    sex: Sex,
    height_cm: float,
    waist_cm: float,
    neck_cm: float,
    hips_cm: float | None = None,
) -> float | None:
    """US Navy circumference method, metric (cm), log base 10."""
    if sex == "male":
        girth = waist_cm - neck_cm
        if girth <= 0:
            return None
        value = (
            495 / (1.0324 - 0.19077 * math.log10(girth) + 0.15456 * math.log10(height_cm)) - 450
        )
    else:
        if hips_cm is None:
            return None
        girth = waist_cm + hips_cm - neck_cm
        if girth <= 0:
            return None
        value = (
            495 / (1.29579 - 0.35004 * math.log10(girth) + 0.22100 * math.log10(height_cm)) - 450
        )
    if not 2 <= value <= 70:
        return None
    return round(value, 1)
