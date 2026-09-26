from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from app.crud import list_rows
from app.db import Conn
from app.profiles import Profile
from app.services.goal_service import goal_with_projection
from app.services.series_service import UTC_ZONE, local_today, series_for

HERO = ["fat_mass_kg", "lean_mass_kg"]
CARDS = ["body_fat_pct", "muscle_mass_kg"]
SECONDARY = ["weight_kg", "bmi", "waist_cm"]


def _r(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def _summary(
    conn: Conn,
    user_id: UUID,
    metric: str,
    profile: Profile | None,
    today: date,
    directions: dict[str, str],
) -> dict[str, Any]:
    series = series_for(conn, user_id, metric, profile, "3M", today)
    past = [p for p in series.trend if p.day <= today - timedelta(days=30)]
    change_30d = series.latest - past[-1].value if past and series.latest is not None else None
    return {
        "metric": metric,
        "label": series.label,
        "unit": series.unit,
        "latest": _r(series.latest),
        "change_30d": _r(change_30d),
        "goal_direction": directions.get(metric),
        "sparkline": [{"date": p.day, "value": round(p.value, 2)} for p in series.trend],
    }


def _days_since(
    conn: Conn, query: str, user_id: UUID, profile: Profile | None, today: date
) -> int | None:
    row = conn.execute(query, (user_id,)).fetchone()
    if row is None or row["last"] is None:
        return None
    tz = profile.tz if profile else UTC_ZONE
    last: datetime = row["last"]
    return (today - last.astimezone(tz).date()).days


def build_dashboard(
    conn: Conn, user_id: UUID, profile: Profile | None, now: datetime
) -> dict[str, Any]:
    today = local_today(now, profile)
    active = list_rows(conn, "goals", user_id, "start_date", filters={"status": "active"})
    directions = {
        g["metric"]: ("up" if g["target_value"] > g["start_value"] else "down") for g in active
    }

    def group(metrics: list[str]) -> list[dict[str, Any]]:
        return [_summary(conn, user_id, m, profile, today, directions) for m in metrics]

    return {
        "hero": group(HERO),
        "cards": group(CARDS),
        "secondary": group(SECONDARY),
        "goals": [goal_with_projection(conn, user_id, g, profile, today) for g in active],
        "nudges": {
            "days_since_weigh_in": _days_since(
                conn,
                "select max(measured_at) as last from body_entries where user_id = %s",
                user_id,
                profile,
                today,
            ),
            "days_since_photo": _days_since(
                conn,
                "select max(taken_at) as last from progress_photos where user_id = %s",
                user_id,
                profile,
                today,
            ),
        },
    }
