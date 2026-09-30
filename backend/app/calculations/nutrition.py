from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.calculations.body import Sex
from app.nutrients import NUTRIENTS, Nutrients

ACTIVITY_FACTORS = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "very": 1.725}
MODE_DEFICIT = {"recomp": 10.0, "cut": 20.0, "maintain": 0.0, "lean_bulk": -7.0}
KCAL_FLOOR = {"male": 1500, "female": 1200}


def scale(per_100g: Nutrients, grams: float) -> Nutrients:
    return {k: v * grams / 100 for k, v in per_100g.items()}


def scale_snapshot(snapshot: Nutrients, old_grams: float, new_grams: float) -> Nutrients:
    return {k: v * new_grams / old_grams for k, v in snapshot.items()}


@dataclass(frozen=True)
class DayTotals:
    totals: Nutrients
    coverage: dict[str, float]  # 0..1 share of kcal from entries reporting the nutrient


def day_totals(entries: Iterable[Nutrients]) -> DayTotals:
    items = list(entries)
    kcal = sum(e.get("energy_kcal", 0.0) for e in items)
    totals: Nutrients = {}
    coverage: dict[str, float] = {}
    for key in NUTRIENTS:
        known = [e for e in items if key in e]
        if known:
            totals[key] = sum(e[key] for e in known)
        covered = sum(e.get("energy_kcal", 0.0) for e in known)
        coverage[key] = covered / kcal if kcal > 0 else (1.0 if known else 0.0)
    return DayTotals(totals, coverage)


def day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)
    return start, end  # half-open [start, end)


def age_on(dob: date, today: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def bmr(
    sex: Sex, age: int, weight_kg: float, height_cm: float, lean_mass_kg: float | None = None
) -> float:
    if lean_mass_kg is not None:
        return 370 + 21.6 * lean_mass_kg  # Katch-McArdle
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age  # Mifflin-St Jeor
    return base + 5 if sex == "male" else base - 161


@dataclass(frozen=True)
class Targets:
    energy_kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    fiber_g: int


def _round(value: float, step: int) -> int:
    return int(step * round(value / step))


def targets_from_tdee(
    tdee: float,
    *,
    mode: str,
    deficit_pct: float | None,
    protein_g_per_kg: float,
    weight_kg: float,
    bmr_kcal: float,
    sex: Sex,
) -> Targets:
    deficit = MODE_DEFICIT[mode] if deficit_pct is None else deficit_pct
    kcal = max(tdee * (1 - deficit / 100), bmr_kcal, KCAL_FLOOR[sex])
    protein = protein_g_per_kg * weight_kg
    fat = max(0.25 * kcal / 9, 0.6 * weight_kg)
    carbs = (kcal - 4 * protein - 9 * fat) / 4
    if carbs < 0:
        protein = 1.6 * weight_kg
        carbs = (kcal - 4 * protein - 9 * fat) / 4
    if carbs < 0:  # cap the deficit: raise calories to cover protein and fat
        kcal, carbs = 4 * protein + 9 * fat, 0.0
    return Targets(
        _round(kcal, 10),
        _round(protein, 5),
        _round(carbs, 5),
        _round(fat, 5),
        _round(14 * kcal / 1000, 5),
    )
