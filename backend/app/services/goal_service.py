from datetime import date
from typing import Any
from uuid import UUID

from app.calculations.goals import project_goal
from app.db import Conn
from app.metrics import METRICS
from app.profiles import Profile
from app.services.series_service import series_for


def goal_with_projection(
    conn: Conn, user_id: UUID, row: dict[str, Any], profile: Profile | None, today: date
) -> dict[str, Any]:
    spec = METRICS[row["metric"]]
    series = series_for(conn, user_id, row["metric"], profile, "ALL", today)
    projection = project_goal(
        start=float(row["start_value"]),
        target=float(row["target_value"]),
        current=series.latest,
        rate_per_week=series.weekly_rate,
        today=today,
        flat_threshold=spec.flat_threshold,
    )
    return {
        **row,
        "projection": {
            "current": None if series.latest is None else round(series.latest, 2),
            "progress_pct": projection.progress_pct,
            "state": projection.state,
            "projected_date": projection.projected_date,
        },
    }
