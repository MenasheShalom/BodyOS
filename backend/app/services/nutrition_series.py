"""Series for nutrition metrics: daily totals of eligible days, and the weekly TDEE."""

from collections import defaultdict
from datetime import date, timedelta
from uuid import UUID

from app.calculations.series import Point, change, weekly_means
from app.db import Conn
from app.metrics import MetricSpec
from app.profiles import Profile

ROLLING_DAYS = 7


def rolling_mean(points: list[Point], days: int = ROLLING_DAYS) -> list[Point]:
    """For each point, the mean of the points in the `days` days ending on it."""
    out = []
    for p in points:
        window = [q.value for q in points if p.day - timedelta(days=days) < q.day <= p.day]
        out.append(Point(p.day, sum(window) / len(window)))
    return out


def _daily_points(
    conn: Conn, user_id: UUID, profile: Profile, key: str, days: set[date]
) -> list[Point]:
    rows = conn.execute(
        "select eaten_at, nutrients from food_log where user_id = %s", (user_id,)
    ).fetchall()
    totals: dict[date, float] = defaultdict(float)
    for r in rows:
        day = r["eaten_at"].astimezone(profile.tz).date()
        if day in days:
            totals[day] += r["nutrients"].get(key, 0.0)
    return [Point(d, v) for d, v in sorted(totals.items())]


def nutrition_points(
    conn: Conn, user_id: UUID, spec: MetricSpec, profile: Profile | None, today: date
) -> tuple[list[Point], list[Point]]:
    """(points, trend) for a nutrition metric over all history."""
    # Imported here: the insight services depend on the series services.
    from app.services.insight_service import food_days, load_insight
    from app.services.nutrition_service import NeedsData

    if profile is None:
        return [], []
    try:
        insight = load_insight(conn, user_id, profile, today)
    except NeedsData:
        insight = None
    if spec.key == "tdee_kcal":
        if insight is None:
            return [], []
        steps = [Point(w.day, w.smoothed) for w in insight.tdee.weekly]
        return steps, steps
    eligible = insight.eligible if insight else food_days(conn, user_id, profile, None)
    points = _daily_points(conn, user_id, profile, spec.key, set(eligible))
    return points, rolling_mean(points)


def build_nutrition_series(
    conn: Conn,
    user_id: UUID,
    spec: MetricSpec,
    profile: Profile | None,
    range_days: int | None,
    today: date,
) -> tuple[list[Point], list[Point], float | None]:
    """Points and trend within the range, and the change of the trend across it."""
    points, trend = nutrition_points(conn, user_id, spec, profile, today)
    start = None if range_days is None else today - timedelta(days=range_days)
    points = [p for p in points if start is None or p.day >= start]
    trend = [p for p in trend if start is None or p.day >= start]
    range_change = change(trend)
    if points and (points[-1].day - points[0].day).days > 366:
        points, trend = weekly_means(points), weekly_means(trend)
    return points, trend, range_change
