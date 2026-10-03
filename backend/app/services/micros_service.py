from datetime import date, timedelta
from uuid import UUID

from app.calculations.nutrition import age_on, day_bounds, day_totals, kcal_target
from app.db import Conn
from app.nutrient_reference import SHOWN, reference
from app.nutrition_schemas import MicroOut, MicrosOut
from app.profiles import Profile
from app.services.insight_service import food_days
from app.services.nutrition_service import NeedsData, estimate, load_settings

MIN_COVERAGE = 0.6  # below this, too little logged food reports the nutrient to judge it
LOW_SHARE = 0.7  # under 70% of the reference counts as low


def micros(conn: Conn, user_id: UUID, profile: Profile, today: date, window: int) -> MicrosOut:
    settings = load_settings(conn, user_id)
    try:
        start = estimate(
            conn,
            user_id,
            profile,
            today,
            activity_level=settings.activity_level,
            mode=settings.mode,
            deficit_pct=settings.deficit_pct,
            protein_g_per_kg=settings.protein_g_per_kg,
        )
        fallback: float | None = kcal_target(
            start.tdee,
            mode=settings.mode,
            deficit_pct=settings.deficit_pct,
            bmr_kcal=start.bmr,
            sex=profile.sex,
        )
    except NeedsData:
        fallback = None  # no weigh-in yet: only flagged days are left out
    first = today - timedelta(days=window - 1)
    days = {d for d in food_days(conn, user_id, profile, fallback) if first <= d <= today}
    lo, _ = day_bounds(first, profile.tz)
    _, hi = day_bounds(today, profile.tz)
    rows = conn.execute(
        "select eaten_at, nutrients from food_log"
        " where user_id = %s and eaten_at >= %s and eaten_at < %s",
        (user_id, lo, hi),
    ).fetchall()
    entries = [r["nutrients"] for r in rows if r["eaten_at"].astimezone(profile.tz).date() in days]
    totals = day_totals(entries)
    count = len(days)
    avg_kcal = totals.totals.get("energy_kcal", 0.0) / count if count else 0.0
    fibre_target = conn.execute(
        "select fiber_g from nutrition_targets where user_id = %s and effective_from <= %s"
        " order by effective_from desc limit 1",
        (user_id, today),
    ).fetchone()
    age = age_on(profile.date_of_birth, today)

    nutrients = []
    for key in SHOWN:
        ref = reference(
            profile.sex, age, key, avg_kcal, fibre_target["fiber_g"] if fibre_target else None
        )
        coverage = totals.coverage.get(key, 0.0) if count else 0.0
        average = totals.totals[key] / count if count and key in totals.totals else None
        if ref is None:
            status = "no_reference"
        elif coverage < MIN_COVERAGE or average is None:
            status = "not_enough_data"
        elif ref[1] == "limit":
            status = "over_limit" if average > ref[0] else "ok"
        else:
            status = "low" if average < LOW_SHARE * ref[0] else "ok"
        nutrients.append(
            MicroOut(
                key=key,
                average=None if average is None else round(average, 1),
                reference=None if ref is None else round(ref[0], 1),
                kind=None if ref is None else ref[1],
                coverage=round(coverage, 2),
                status=status,
            )
        )
    return MicrosOut(window=window, days_counted=count, nutrients=nutrients)
