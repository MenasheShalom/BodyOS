from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from app.calculations.series import (
    Point,
    change,
    daily_means,
    ewma_trend,
    weekly_last,
    weekly_means,
    weekly_rate,
)
from app.db import Conn
from app.metrics import METRICS, MetricSpec, Readings, load_readings
from app.profiles import Profile

RangeKey = Literal["1M", "3M", "6M", "1Y", "ALL"]
RANGE_DAYS: dict[str, int | None] = {"1M": 30, "3M": 91, "6M": 182, "1Y": 365, "ALL": None}
UTC_ZONE = ZoneInfo("UTC")


@dataclass(frozen=True)
class SeriesResult:
    metric: str
    label: str
    unit: str
    points: list[Point]
    trend: list[Point]
    change: float | None
    weekly_rate: float | None
    min: float | None
    max: float | None
    latest: float | None


def local_today(now: datetime, profile: Profile | None) -> date:
    return now.astimezone(profile.tz if profile else UTC_ZONE).date()


def build_series(
    readings: Readings, spec: MetricSpec, tz: ZoneInfo, range_key: str, today: date
) -> SeriesResult:
    daily = daily_means(readings, tz)
    trend = ewma_trend(daily, spec.alpha)
    rate = weekly_rate(trend, today)
    days = RANGE_DAYS[range_key]
    start = None if days is None else today - timedelta(days=days)
    points = [p for p in daily if start is None or p.day >= start]
    trend_in_range = [p for p in trend if start is None or p.day >= start]
    values = [p.value for p in points]
    range_change = change(trend_in_range)
    if points and (points[-1].day - points[0].day).days > 366:
        points, trend_in_range = weekly_means(points), weekly_last(trend_in_range)
    return SeriesResult(
        metric=spec.key,
        label=spec.label,
        unit=spec.unit,
        points=points,
        trend=trend_in_range,
        change=range_change,
        weekly_rate=rate,
        min=min(values) if values else None,
        max=max(values) if values else None,
        latest=trend[-1].value if trend else None,
    )


def series_for(
    conn: Conn,
    user_id: UUID,
    metric: str,
    profile: Profile | None,
    range_key: str,
    today: date,
) -> SeriesResult:
    spec = METRICS[metric]
    if spec.source == "nutrition":
        from app.services.nutrition_series import build_nutrition_series

        points, trend, range_change = build_nutrition_series(
            conn, user_id, spec, profile, RANGE_DAYS[range_key], today
        )
        values = [p.value for p in points]
        return SeriesResult(
            metric=spec.key,
            label=spec.label,
            unit=spec.unit,
            points=points,
            trend=trend,
            change=range_change,
            weekly_rate=None,  # a weekly rate of intake isn't meaningful
            min=min(values) if values else None,
            max=max(values) if values else None,
            latest=trend[-1].value if trend else None,
        )
    tz = profile.tz if profile else UTC_ZONE
    return build_series(load_readings(conn, user_id, metric, profile), spec, tz, range_key, today)
