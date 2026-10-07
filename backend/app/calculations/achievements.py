"""Pure helpers that find the day a trophy was earned, and how far along a locked one is."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from app.calculations.series import Point


@dataclass(frozen=True)
class Outcome:
    earned_on: date | None
    progress: float  # towards the trophy's target, in its own unit


def nth(days: Sequence[date], n: int) -> Outcome:
    """Earned on the day of the n-th item (days sorted, repeats allowed)."""
    return Outcome(days[n - 1] if len(days) >= n else None, min(len(days), n))


def streak(days: Iterable[date], n: int) -> Outcome:
    """n days in a row. Progress is the best run so far."""
    best = run = 0
    prev: date | None = None
    earned: date | None = None
    for day in sorted(set(days)):
        run = run + 1 if prev is not None and day - prev == timedelta(days=1) else 1
        best = max(best, run)
        if earned is None and run >= n:
            earned = day
        prev = day
    return Outcome(earned, min(best, n))


def week_streak(days: Iterable[date], n: int) -> Outcome:
    """At least one day in each of n consecutive Monday-to-Sunday weeks."""
    days = list(days)
    weeks = {d - timedelta(days=d.weekday()) for d in days}
    best = run = 0
    prev: date | None = None
    earned: date | None = None
    for week in sorted(weeks):
        run = run + 1 if prev is not None and week - prev == timedelta(days=7) else 1
        best = max(best, run)
        if earned is None and run >= n:
            earned = week
        prev = week
    if earned is not None:
        # earned on the first qualifying day of the n-th week
        earned = min(d for d in days if earned <= d < earned + timedelta(days=7))
    return Outcome(earned, min(best, n))


def in_window(days: Iterable[date], k: int, window: int = 7) -> Outcome:
    """k qualifying days within any `window` consecutive days."""
    ordered = sorted(set(days))
    best = 0
    for i, day in enumerate(ordered):
        count = sum(1 for d in ordered[: i + 1] if day - d < timedelta(days=window))
        best = max(best, count)
        if count >= k:
            return Outcome(day, k)
    return Outcome(None, best)


def drop_from_peak(trend: Sequence[Point], amount: float) -> Outcome:
    """The trend fell `amount` below its highest value so far. Progress is the biggest drop."""
    peak: float | None = None
    best = 0.0
    for p in trend:
        peak = p.value if peak is None else max(peak, p.value)
        drop = peak - p.value
        best = max(best, drop)
        if drop >= amount - 1e-9:
            return Outcome(p.day, amount)
    return Outcome(None, round(best, 1))


def crossed(trend: Sequence[Point], start_day: date, start: float, level: float) -> date | None:
    """First day on or after `start_day` the trend reached `level`, moving away from `start`."""
    direction = 1 if level > start else -1
    for p in trend:
        if p.day >= start_day and (p.value - level) * direction >= 0:
            return p.day
    return None
