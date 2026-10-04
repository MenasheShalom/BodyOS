"""Adaptive TDEE from logged intake and weight (spec §6.3).

Energy balance over a window: what was eaten minus what the body stored or lost.
    observed TDEE = mean daily intake − weight slope (kg/day) × 7700 kcal/kg
Observations are taken once a week, on the user's check-in day, from the 28 days before it,
and smoothed into a running estimate that starts from the BMR × activity guess.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import pstdev

from app.calculations.series import Point, ewma_trend

WINDOW_DAYS = 28
MIN_ELIGIBLE_DAYS = 14
MIN_WEIGH_INS = 8
MIN_WEIGHT_SPAN_DAYS = 14
TREND_ALPHA = 0.1  # the weight trend from sub-project 1
TREND_WARM_UP_DAYS = 14
KCAL_PER_KG = 7700
HALF_LOGGED = 0.5  # a day under half the target is treated as half-logged and skipped
MAX_WEEKLY_STEP = 0.7  # a full window of logged days moves the estimate 70% of the way


def eligible_days(
    day_kcal: Mapping[date, float],
    excluded: set[date],
    reference_kcal: Callable[[date], float],
) -> dict[date, float]:
    """Days that count: not flagged incomplete and at least half the day's target."""
    return {
        d: kcal
        for d, kcal in day_kcal.items()
        if d not in excluded and kcal >= HALF_LOGGED * reference_kcal(d)
    }


def check_in_days(first: date, today: date, weekday: int) -> list[date]:
    """Every check-in weekday from `first` up to and including `today`."""
    day = first + timedelta(days=(weekday - first.weekday()) % 7)
    days = []
    while day <= today:
        days.append(day)
        day += timedelta(days=7)
    return days


@dataclass(frozen=True)
class Observation:
    tdee: float
    eligible_days: int
    mean_intake: float
    weight_change_kg: float  # over the window, from the fitted slope


def _slope_per_day(points: Sequence[Point]) -> float:
    """Least-squares slope through the readings, in kg per day."""
    xs = [float((p.day - points[0].day).days) for p in points]
    ys = [p.value for p in points]
    mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mean_x) ** 2 for x in xs)
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True)) / sxx


def observe(
    end: date,
    eligible: Mapping[date, float],
    weights: Sequence[Point],
    weight_trend: Sequence[Point],
) -> Observation | None:
    """One energy-balance reading for the 28 days ending on `end`, or None without enough data.

    The weight change is a least-squares slope through the window, so no single morning's
    water weight decides it. It is fitted to the EWMA trend once the trend has two weeks of
    history before the window; before that the trend is still catching up with any steady
    loss or gain and would understate it, so the daily weights themselves are used.
    """
    start = end - timedelta(days=WINDOW_DAYS)
    intake = [kcal for d, kcal in eligible.items() if start < d <= end]
    if len(intake) < MIN_ELIGIBLE_DAYS:
        return None
    warmed_up = bool(weight_trend) and weight_trend[0].day <= start - timedelta(
        days=TREND_WARM_UP_DAYS
    )
    series = weight_trend if warmed_up else weights
    inside = sorted((p for p in series if start < p.day <= end), key=lambda p: p.day)
    if len(inside) < MIN_WEIGH_INS:
        return None
    if (inside[-1].day - inside[0].day).days < MIN_WEIGHT_SPAN_DAYS:
        return None
    mean_intake = sum(intake) / len(intake)
    per_day = _slope_per_day(inside)
    return Observation(
        tdee=mean_intake - per_day * KCAL_PER_KG,
        eligible_days=len(intake),
        mean_intake=mean_intake,
        weight_change_kg=per_day * WINDOW_DAYS,
    )


@dataclass(frozen=True)
class WeekEstimate:
    day: date
    observed: float | None
    smoothed: float
    eligible_days: int


@dataclass(frozen=True)
class TdeeResult:
    weekly: list[WeekEstimate]
    current: float
    confidence: float | None  # ± standard deviation of the last 4 observations
    has_data: bool  # False while the estimate is still the starting guess
    eligible_days_now: int  # eligible days in the 28 days up to today


def adaptive_tdee(
    eligible: Mapping[date, float],
    weights: Sequence[Point],
    seed: float,
    today: date,
    check_in_weekday: int,
) -> TdeeResult:
    """`weights` are daily mean weigh-ins; `seed` is the BMR × activity starting estimate."""
    weight_trend = ewma_trend(sorted(weights, key=lambda p: p.day), TREND_ALPHA)
    window_start = today - timedelta(days=WINDOW_DAYS)
    eligible_now = sum(1 for d in eligible if window_start < d <= today)
    if not eligible:
        return TdeeResult([], seed, None, False, 0)
    estimate = seed
    weekly: list[WeekEstimate] = []
    observed: list[float] = []
    for day in check_in_days(min(eligible), today, check_in_weekday):
        obs = observe(day, eligible, weights, weight_trend)
        if obs is not None:
            step = MAX_WEEKLY_STEP * min(obs.eligible_days, WINDOW_DAYS) / WINDOW_DAYS
            estimate += step * (obs.tdee - estimate)
            observed.append(obs.tdee)
        count = sum(1 for d in eligible if day - timedelta(days=WINDOW_DAYS) < d <= day)
        weekly.append(WeekEstimate(day, obs.tdee if obs else None, estimate, count))
    confidence = pstdev(observed[-4:]) if len(observed) >= 4 else None
    return TdeeResult(weekly, estimate, confidence, bool(observed), eligible_now)
