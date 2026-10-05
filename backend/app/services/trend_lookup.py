from datetime import date
from uuid import UUID

from app.calculations.series import Point, daily_means, ewma_trend
from app.db import Conn
from app.metrics import METRICS, load_readings
from app.profiles import Profile


def trend_points(conn: Conn, user_id: UUID, metric: str, profile: Profile) -> list[Point]:
    """The metric's EWMA trend, one point per day with a reading."""
    daily = daily_means(load_readings(conn, user_id, metric, profile), profile.tz)
    return ewma_trend(daily, METRICS[metric].alpha)


def value_on(trend: list[Point], day: date) -> float | None:
    """The trend as it stood on `day` (its last point on or before it)."""
    before = [p for p in trend if p.day <= day]
    return before[-1].value if before else None
