"""Adaptive TDEE, weekly suggestions and the inputs they share (spec §6.3–6.4)."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from app.calculations.nutrition import (
    Suggestion,
    Targets,
    kcal_target,
    meaningfully_different,
    suggest_targets,
)
from app.calculations.series import Point, daily_means, ewma_trend, weekly_rate
from app.calculations.tdee import TdeeResult, adaptive_tdee, eligible_days
from app.db import Conn
from app.metrics import METRICS, load_readings
from app.nutrition_schemas import EstimateOut, NutritionSettingsOut
from app.profiles import Profile
from app.services.nutrition_service import estimate, load_settings

TARGET_COLUMNS = "effective_from, energy_kcal, protein_g, carbs_g, fat_g, fiber_g"


def day_kcal(conn: Conn, user_id: UUID, tz: ZoneInfo) -> dict[date, float]:
    """Calories logged per local day."""
    rows = conn.execute(
        "select eaten_at, (nutrients->>'energy_kcal')::float as kcal from food_log"
        " where user_id = %s",
        (user_id,),
    ).fetchall()
    totals: dict[date, float] = defaultdict(float)
    for r in rows:
        totals[r["eaten_at"].astimezone(tz).date()] += r["kcal"]
    return dict(totals)


def excluded_days(conn: Conn, user_id: UUID) -> set[date]:
    rows = conn.execute(
        "select day from nutrition_day_flags where user_id = %s and excluded", (user_id,)
    ).fetchall()
    return {r["day"] for r in rows}


def target_history(conn: Conn, user_id: UUID) -> list[dict[str, Any]]:
    return conn.execute(
        f"select {TARGET_COLUMNS} from nutrition_targets where user_id = %s"
        " order by effective_from",
        (user_id,),
    ).fetchall()


def as_targets(row: dict[str, Any]) -> Targets:
    return Targets(
        row["energy_kcal"], row["protein_g"], row["carbs_g"], row["fat_g"], row["fiber_g"]
    )


@dataclass(frozen=True)
class Insight:
    settings: NutritionSettingsOut
    start: EstimateOut  # the BMR × activity estimate the adaptive TDEE starts from
    tdee: TdeeResult
    eligible: dict[date, float]
    weight_trend: list[Point]
    targets: list[dict[str, Any]]


def food_days(
    conn: Conn, user_id: UUID, profile: Profile, fallback_kcal: float | None
) -> dict[date, float]:
    """Eligible days and their calories: not flagged incomplete and at least half the target
    in force (or `fallback_kcal` before any target existed)."""
    targets = target_history(conn, user_id)

    def reference(day: date) -> float:
        in_force = [t for t in targets if t["effective_from"] <= day]
        if in_force:
            return float(in_force[-1]["energy_kcal"])
        return fallback_kcal or 0.0

    return eligible_days(
        day_kcal(conn, user_id, profile.tz), excluded_days(conn, user_id), reference
    )


def load_insight(conn: Conn, user_id: UUID, profile: Profile | None, today: date) -> Insight:
    """Everything the TDEE, suggestion and nutrition series need. Raises NeedsData without a
    profile or a weigh-in."""
    settings = load_settings(conn, user_id)
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
    assert profile is not None  # estimate() raises NeedsData without one
    fallback = kcal_target(
        start.tdee,
        mode=settings.mode,
        deficit_pct=settings.deficit_pct,
        bmr_kcal=start.bmr,
        sex=profile.sex,
    )
    eligible = food_days(conn, user_id, profile, fallback)
    weights = daily_means(load_readings(conn, user_id, "weight_kg", profile), profile.tz)
    trend = ewma_trend(weights, METRICS["weight_kg"].alpha)
    tdee = adaptive_tdee(eligible, weights, start.tdee, today, settings.check_in_weekday)
    return Insight(settings, start, tdee, eligible, trend, target_history(conn, user_id))


def check_in_week(today: date, weekday: int) -> date:
    """The most recent check-in day on or before today."""
    return today - timedelta(days=(today.weekday() - weekday) % 7)


def weekly_intake(eligible: dict[date, float], day: date) -> float | None:
    """Average calories over the eligible days in the week ending on `day`."""
    week = [kcal for d, kcal in eligible.items() if day - timedelta(days=7) < d <= day]
    return sum(week) / len(week) if week else None


@dataclass(frozen=True)
class OwedSuggestion:
    week_start: date
    suggestion: Suggestion
    current: Targets | None


def owed_suggestion(
    conn: Conn, user_id: UUID, profile: Profile, insight: Insight, today: date
) -> OwedSuggestion | None:
    """The check-in suggestion for this week, or None if nothing is owed."""
    if not insight.tdee.has_data:
        return None
    week_start = check_in_week(today, insight.settings.check_in_weekday)
    dismissed = conn.execute(
        "select 1 from target_suggestion_dismissals where user_id = %s and week_start = %s",
        (user_id, week_start),
    ).fetchone()
    if dismissed is not None:
        return None
    # The user already set targets this check-in week, by accepting or editing.
    if any(t["effective_from"] >= week_start for t in insight.targets):
        return None
    in_force = [t for t in insight.targets if t["effective_from"] <= today]
    current = as_targets(in_force[-1]) if in_force else None
    weight = insight.start.weight_kg
    suggestion = suggest_targets(
        current,
        insight.tdee.current,
        mode=insight.settings.mode,
        deficit_pct=insight.settings.deficit_pct,
        protein_g_per_kg=insight.settings.protein_g_per_kg,
        weight_kg=weight,
        weekly_rate_kg=weekly_rate(insight.weight_trend, today),
        bmr_kcal=insight.start.bmr,
        sex=profile.sex,
    )
    if current is not None and not meaningfully_different(suggestion.targets, current):
        return None
    return OwedSuggestion(week_start, suggestion, current)


def eligible_in_window(eligible: dict[date, float], today: date, days: int) -> dict[date, float]:
    return {d: k for d, k in eligible.items() if today - timedelta(days=days) < d <= today}
