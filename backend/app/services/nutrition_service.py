from dataclasses import asdict
from datetime import date
from uuid import UUID

from app.calculations.nutrition import ACTIVITY_FACTORS, age_on, bmr, targets_from_tdee
from app.db import Conn
from app.nutrition_schemas import (
    ActivityLevel,
    EstimateOut,
    MacroTargets,
    Mode,
    NutritionSettingsIn,
    NutritionSettingsOut,
)
from app.profiles import Profile
from app.services.series_service import series_for

SETTINGS_COLUMNS = (
    "mode, deficit_pct, protein_g_per_kg, activity_level, check_in_weekday, food_country"
)


class NeedsData(Exception):
    """The estimate needs something the user hasn't entered yet."""


def load_settings(conn: Conn, user_id: UUID) -> NutritionSettingsOut:
    row = conn.execute(
        f"select {SETTINGS_COLUMNS} from nutrition_settings where user_id = %s", (user_id,)
    ).fetchone()
    if row is None:
        return NutritionSettingsOut(configured=False)
    return NutritionSettingsOut(**row, configured=True)


def save_settings(conn: Conn, user_id: UUID, body: NutritionSettingsIn) -> NutritionSettingsOut:
    values = body.model_dump()
    cols = ", ".join(values)
    updates = ", ".join(f"{c} = excluded.{c}" for c in values)
    conn.execute(
        f"insert into nutrition_settings (user_id, {cols})"
        f" values (%s, {', '.join(['%s'] * len(values))})"
        f" on conflict (user_id) do update set {updates}",
        (user_id, *values.values()),
    )
    return load_settings(conn, user_id)


def current_body(
    conn: Conn, user_id: UUID, profile: Profile, today: date
) -> tuple[float | None, float | None]:
    """Latest weight and lean mass trend values, as on the dashboard."""
    weight = series_for(conn, user_id, "weight_kg", profile, "1M", today).latest
    lean = series_for(conn, user_id, "lean_mass_kg", profile, "1M", today).latest
    return weight, lean


def estimate(
    conn: Conn,
    user_id: UUID,
    profile: Profile | None,
    today: date,
    *,
    activity_level: ActivityLevel,
    mode: Mode,
    deficit_pct: float | None,
    protein_g_per_kg: float,
) -> EstimateOut:
    if profile is None:
        raise NeedsData("Complete your profile first")
    weight, lean = current_body(conn, user_id, profile, today)
    if weight is None:
        raise NeedsData("Log a weigh-in first")
    bmr_kcal = bmr(
        profile.sex, age_on(profile.date_of_birth, today), weight, profile.height_cm, lean
    )
    factor = ACTIVITY_FACTORS[activity_level]
    tdee = bmr_kcal * factor
    targets = targets_from_tdee(
        tdee,
        mode=mode,
        deficit_pct=deficit_pct,
        protein_g_per_kg=protein_g_per_kg,
        weight_kg=weight,
        bmr_kcal=bmr_kcal,
        sex=profile.sex,
    )
    return EstimateOut(
        bmr=round(bmr_kcal),
        tdee=round(tdee),
        method="katch" if lean is not None else "mifflin",
        activity_factor=factor,
        weight_kg=round(weight, 1),
        lean_mass_kg=None if lean is None else round(lean, 1),
        targets=MacroTargets(**asdict(targets)),
    )
