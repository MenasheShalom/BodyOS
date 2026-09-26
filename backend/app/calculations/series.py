from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Point:
    day: date
    value: float


def daily_means(readings: Iterable[tuple[datetime, float]], tz: ZoneInfo) -> list[Point]:
    buckets: dict[date, list[float]] = defaultdict(list)
    for measured_at, value in readings:
        buckets[measured_at.astimezone(tz).date()].append(value)
    return [Point(day, sum(vals) / len(vals)) for day, vals in sorted(buckets.items())]


def ewma_trend(points: Sequence[Point], alpha: float) -> list[Point]:
    """Time-aware EWMA: after a gap of n days, the new reading gets weight 1-(1-alpha)^n."""
    if not points:
        return []
    trend = [Point(points[0].day, points[0].value)]
    for point in points[1:]:
        prev = trend[-1]
        gap_days = (point.day - prev.day).days
        weight = 1 - (1 - alpha) ** gap_days
        trend.append(Point(point.day, prev.value + weight * (point.value - prev.value)))
    return trend


def weekly_rate(
    trend: Sequence[Point],
    today: date,
    window_days: int = 28,
    min_points: int = 4,
    min_span_days: int = 14,
) -> float | None:
    """Least-squares slope of trend values in the last `window_days`, per week."""
    cutoff = today - timedelta(days=window_days)
    recent = [p for p in trend if cutoff < p.day <= today]
    if len(recent) < min_points:
        return None
    if (recent[-1].day - recent[0].day).days < min_span_days:
        return None
    xs = [float((p.day - recent[0].day).days) for p in recent]
    ys = [p.value for p in recent]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True))
    return sxy / sxx * 7


def change(points: Sequence[Point]) -> float | None:
    if len(points) < 2:
        return None
    return points[-1].value - points[0].value


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def weekly_means(points: Sequence[Point]) -> list[Point]:
    buckets: dict[date, list[float]] = defaultdict(list)
    for p in points:
        buckets[_week_start(p.day)].append(p.value)
    return [Point(week, sum(vals) / len(vals)) for week, vals in sorted(buckets.items())]


def weekly_last(points: Sequence[Point]) -> list[Point]:
    last: dict[date, float] = {}
    for p in sorted(points, key=lambda p: p.day):
        last[_week_start(p.day)] = p.value
    return [Point(week, value) for week, value in sorted(last.items())]
