from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.calculations.nutrition import (
    Targets,
    age_on,
    bmr,
    day_bounds,
    day_totals,
    scale,
    scale_snapshot,
    targets_from_tdee,
)
from app.nutrients import validate_nutrients


def test_scale_keeps_unknown_keys_absent() -> None:
    assert scale({"energy_kcal": 250, "protein_g": 10}, 40) == {"energy_kcal": 100, "protein_g": 4}


def test_scale_snapshot_is_proportional() -> None:
    assert scale_snapshot({"energy_kcal": 100, "fat_g": 2}, 40, 60) == {
        "energy_kcal": 150,
        "fat_g": 3,
    }


def test_totals_track_coverage() -> None:
    t = day_totals(
        [
            {"energy_kcal": 300, "vit_d_mcg": 2.0},
            {"energy_kcal": 700},  # packaged food: no vitamin D reported
        ]
    )
    assert t.totals["energy_kcal"] == 1000
    assert t.totals["vit_d_mcg"] == 2.0
    assert t.coverage["vit_d_mcg"] == pytest.approx(0.3)
    assert "zinc_mg" not in t.totals and t.coverage["zinc_mg"] == 0


def test_totals_empty_day() -> None:
    t = day_totals([])
    assert t.totals == {} and t.coverage["energy_kcal"] == 0


def test_day_bounds_israel_dst() -> None:
    start, end = day_bounds(date(2026, 3, 27), ZoneInfo("Asia/Jerusalem"))  # DST starts that night
    assert start == datetime(2026, 3, 26, 22, 0, tzinfo=ZoneInfo("UTC"))
    assert end == datetime(2026, 3, 27, 21, 0, tzinfo=ZoneInfo("UTC"))  # 23-hour day


def test_bmr_katch_when_lean_mass_known() -> None:
    assert bmr("male", 38, 85, 180, lean_mass_kg=68) == pytest.approx(370 + 21.6 * 68)


def test_bmr_mifflin_otherwise() -> None:
    assert bmr("male", 38, 85, 180) == pytest.approx(10 * 85 + 6.25 * 180 - 5 * 38 + 5)
    assert bmr("female", 38, 65, 165) == pytest.approx(10 * 65 + 6.25 * 165 - 5 * 38 - 161)


def test_age_on_birthday_boundary() -> None:
    assert age_on(date(1988, 10, 1), date(2026, 9, 30)) == 37
    assert age_on(date(1988, 10, 1), date(2026, 10, 1)) == 38


def test_recomp_targets() -> None:
    t = targets_from_tdee(
        2600,
        mode="recomp",
        deficit_pct=None,
        protein_g_per_kg=2.0,
        weight_kg=85,
        bmr_kcal=1800,
        sex="male",
    )
    assert t == Targets(energy_kcal=2340, protein_g=170, carbs_g=270, fat_g=65, fiber_g=35)


def test_targets_respect_calorie_floor() -> None:
    t = targets_from_tdee(
        1500,
        mode="cut",
        deficit_pct=25,
        protein_g_per_kg=2.0,
        weight_kg=60,
        bmr_kcal=1350,
        sex="female",
    )
    assert t.energy_kcal == 1350


def test_targets_lower_protein_before_negative_carbs() -> None:
    t = targets_from_tdee(
        1900,
        mode="cut",
        deficit_pct=25,
        protein_g_per_kg=3.0,
        weight_kg=110,
        bmr_kcal=1500,
        sex="male",
    )
    assert t.carbs_g >= 0 and t.protein_g == 175  # 1.6 g/kg × 110 rounded to 5


def test_validate_rejects_implausible_and_unknown_keys() -> None:
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": 950}, per_100g=True)
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": 100, "protein_g": 60, "fat_g": 50}, per_100g=True)
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": 100, "caffeine_mg": 5}, per_100g=False)
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": -1}, per_100g=False)


def test_recipe_totals_raw_weight() -> None:
    from app.calculations.nutrition import recipe_totals

    t = recipe_totals(
        [({"energy_kcal": 100, "protein_g": 20}, 200), ({"energy_kcal": 50, "protein_g": 1}, 100)],
        None,
    )
    assert t.weight_g == 300
    assert t.total == {"energy_kcal": 250, "protein_g": 41}
    assert t.per_100g["energy_kcal"] == pytest.approx(250 / 3)
    assert t.incomplete == []


def test_recipe_totals_cooked_weight_and_incomplete() -> None:
    from app.calculations.nutrition import recipe_totals

    t = recipe_totals(
        [({"energy_kcal": 100, "vit_c_mg": 10}, 200), ({"energy_kcal": 50}, 100)],
        cooked_weight_g=250,  # water cooked off
    )
    assert t.per_100g == {"energy_kcal": 100}
    assert t.incomplete == ["vit_c_mg"]


# --- Weekly suggestions (spec §6.4) --------------------------------------------------------

SUGGEST = {
    "mode": "recomp",
    "deficit_pct": None,
    "protein_g_per_kg": 2.0,
    "weight_kg": 85,
    "weekly_rate_kg": -0.3,
    "bmr_kcal": 1800,
    "sex": "male",
}


def test_suggestion_follows_tdee_without_current_targets() -> None:
    from app.calculations.nutrition import suggest_targets

    s = suggest_targets(None, 2600, **SUGGEST)
    assert s.targets.energy_kcal == 2340 and not s.capped and s.warning is None


def test_suggestion_capped_at_150_both_ways() -> None:
    from app.calculations.nutrition import suggest_targets

    current = Targets(energy_kcal=2000, protein_g=170, carbs_g=200, fat_g=60, fiber_g=30)
    up = suggest_targets(current, 2800, **SUGGEST)  # would be 2,520
    assert up.targets.energy_kcal == 2150 and up.capped
    high = Targets(energy_kcal=2700, protein_g=170, carbs_g=300, fat_g=75, fiber_g=40)
    down = suggest_targets(high, 2600, **SUGGEST)  # would be 2,340
    assert down.targets.energy_kcal == 2550 and down.capped


def test_suggestion_never_below_floor() -> None:
    from app.calculations.nutrition import suggest_targets

    current = Targets(energy_kcal=1900, protein_g=170, carbs_g=150, fat_g=55, fiber_g=25)
    s = suggest_targets(current, 1700, **{**SUGGEST, "bmr_kcal": 1850, "mode": "cut"})
    assert s.targets.energy_kcal == 1850  # BMR, not 1,750 (the 150 cap) or 1,360 (the deficit)


def test_fast_loss_stops_further_cuts() -> None:
    from app.calculations.nutrition import suggest_targets

    current = Targets(energy_kcal=2300, protein_g=170, carbs_g=250, fat_g=65, fiber_g=30)
    fast = {**SUGGEST, "weekly_rate_kg": -1.0}  # more than 1% of 85 kg a week
    s = suggest_targets(current, 2400, **fast)  # would cut to 2,160
    assert s.targets.energy_kcal == 2300 and s.warning is not None
    up = suggest_targets(current, 2700, **fast)  # raising is still allowed
    assert up.targets.energy_kcal == 2430 and up.warning is None


def test_meaningfully_different() -> None:
    from app.calculations.nutrition import meaningfully_different

    base = Targets(energy_kcal=2300, protein_g=170, carbs_g=250, fat_g=65, fiber_g=30)
    assert not meaningfully_different(base, Targets(2340, 170, 260, 65, 35))
    assert meaningfully_different(base, Targets(2350, 170, 260, 65, 35))
    assert meaningfully_different(base, Targets(2300, 175, 245, 65, 30))
