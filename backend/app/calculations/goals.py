import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

ProjectionState = Literal["insufficient_data", "reached", "not_on_pace", "on_track"]


@dataclass(frozen=True)
class GoalProjection:
    state: ProjectionState
    progress_pct: float | None
    projected_date: date | None


def _progress(start: float, target: float, current: float) -> float:
    if start == target:
        return 100.0
    pct = (start - current) / (start - target) * 100
    return round(max(0.0, min(100.0, pct)), 1)


def project_goal(
    start: float,
    target: float,
    current: float | None,
    rate_per_week: float | None,
    today: date,
    flat_threshold: float,
    max_horizon_days: int = 730,
) -> GoalProjection:
    if current is None:
        return GoalProjection("insufficient_data", None, None)

    progress = _progress(start, target, current)
    direction = 1 if target > start else -1
    if start == target or (current - target) * direction >= 0:
        return GoalProjection("reached", 100.0, None)
    if rate_per_week is None:
        return GoalProjection("insufficient_data", progress, None)
    if rate_per_week * direction <= 0 or abs(rate_per_week) < flat_threshold:
        return GoalProjection("not_on_pace", progress, None)

    days = math.ceil((target - current) / rate_per_week * 7)
    if days > max_horizon_days:
        return GoalProjection("not_on_pace", progress, None)
    return GoalProjection("on_track", progress, today + timedelta(days=days))
