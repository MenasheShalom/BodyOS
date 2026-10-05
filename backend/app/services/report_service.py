"""The numbers a weekly report is written from (spec §5.2). Every figure the user reads in a
report comes from here; the AI only puts them into words."""

from collections import defaultdict
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from app.calculations.goals import project_goal
from app.calculations.nutrition import day_bounds
from app.calculations.series import weekly_rate
from app.db import Conn
from app.metrics import METRICS
from app.nutrients import NUTRIENTS
from app.profiles import Profile
from app.services.insight_service import excluded_days, load_insight
from app.services.micros_service import micros
from app.services.nutrition_service import NeedsData
from app.services.trend_lookup import trend_points, value_on

BODY_METRICS = ("weight_kg", "fat_mass_kg", "lean_mass_kg", "body_fat_pct", "waist_cm")
PROTEIN_HIT = 0.9  # a day counts as hitting protein at 90% of the target or more


def _round(metric: str, value: float) -> float:
    return round(value, 1) if METRICS[metric].unit in ("kg", "%", "cm") else round(value)


def _body(conn: Conn, user_id: UUID, profile: Profile, end: date) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for metric in BODY_METRICS:
        trend = trend_points(conn, user_id, metric, profile)
        now = value_on(trend, end)
        if now is None:
            continue
        before = value_on(trend, end - timedelta(days=7))
        rate = weekly_rate([p for p in trend if p.day <= end], end)
        out[metric] = {
            "label": METRICS[metric].label,
            "unit": METRICS[metric].unit,
            "now": _round(metric, now),
            "week_ago": None if before is None else _round(metric, before),
            "change": None if before is None else round(now - before, 1),
            "rate_per_week": None if rate is None else round(rate, 2),
        }
    return out


def _intake(
    conn: Conn, user_id: UUID, profile: Profile, start: date, end: date
) -> tuple[dict[date, dict[str, float]], set[date]]:
    """Calories and protein per logged local day in [start, end], and the flagged days."""
    lo, _ = day_bounds(start, profile.tz)
    _, hi = day_bounds(end, profile.tz)
    rows = conn.execute(
        "select eaten_at, nutrients from food_log"
        " where user_id = %s and eaten_at >= %s and eaten_at < %s",
        (user_id, lo, hi),
    ).fetchall()
    days: dict[date, dict[str, float]] = defaultdict(lambda: {"kcal": 0.0, "protein": 0.0})
    for r in rows:
        day = days[r["eaten_at"].astimezone(profile.tz).date()]
        day["kcal"] += float(r["nutrients"].get("energy_kcal", 0))
        day["protein"] += float(r["nutrients"].get("protein_g", 0))
    flagged = {d for d in excluded_days(conn, user_id) if start <= d <= end}
    return dict(days), flagged


def _week_food(
    conn: Conn, user_id: UUID, profile: Profile, start: date, end: date, target: Any
) -> dict[str, Any]:
    days, flagged = _intake(conn, user_id, profile, start, end)
    counted = {d: v for d, v in days.items() if d not in flagged}
    out: dict[str, Any] = {"days_logged": len(days), "days_marked_incomplete": len(flagged)}
    if counted:
        out["avg_kcal"] = round(sum(v["kcal"] for v in counted.values()) / len(counted))
        out["avg_protein_g"] = round(sum(v["protein"] for v in counted.values()) / len(counted))
    if target is not None:
        out["target_kcal"] = int(target["energy_kcal"])
        out["target_protein_g"] = int(target["protein_g"])
        if counted:
            goal = PROTEIN_HIT * float(target["protein_g"])
            out["protein_target_days_hit"] = sum(
                1 for v in counted.values() if v["protein"] >= goal
            )
    return out


def _count(conn: Conn, table: str, column: str, user_id: UUID, lo: Any, hi: Any) -> int:
    row = conn.execute(
        f"select count(*) as n from {table} where user_id = %s and {column} >= %s"
        f" and {column} < %s",
        (user_id, lo, hi),
    ).fetchone()
    assert row is not None
    return int(row["n"])


def report_facts(conn: Conn, user_id: UUID, profile: Profile, week_end: date) -> dict[str, Any]:
    """Facts for the week of 7 days ending on `week_end` (a check-in day)."""
    start = week_end - timedelta(days=6)
    lo, _ = day_bounds(start, profile.tz)
    _, hi = day_bounds(week_end, profile.tz)
    target = conn.execute(
        "select energy_kcal, protein_g, effective_from, origin from nutrition_targets"
        " where user_id = %s and effective_from <= %s order by effective_from desc limit 1",
        (user_id, week_end),
    ).fetchone()

    facts: dict[str, Any] = {
        "week": {"from": start.isoformat(), "to": week_end.isoformat()},
        "body": _body(conn, user_id, profile, week_end),
        "weigh_ins": _count(conn, "body_entries", "measured_at", user_id, lo, hi),
        "progress_photos": _count(conn, "progress_photos", "taken_at", user_id, lo, hi),
        "food": _week_food(conn, user_id, profile, start, week_end, target),
        "previous_week_food": _week_food(
            conn, user_id, profile, start - timedelta(days=7), start - timedelta(days=1), target
        ),
    }
    if target is not None and start <= target["effective_from"] <= week_end:
        facts["targets_changed_this_week"] = (
            "accepted the suggested targets"
            if target["origin"] == "suggested"
            else "set new targets by hand"
        )

    try:
        insight = load_insight(conn, user_id, profile, week_end)
        tdee = insight.tdee
        facts["burn"] = {
            "tdee_kcal": round(tdee.current),
            "plus_minus_kcal": None if tdee.confidence is None else round(tdee.confidence),
            "measured": tdee.has_data,
        }
    except NeedsData:
        pass

    low = [m for m in micros(conn, user_id, profile, week_end, 28).nutrients if m.status == "low"]
    facts["low_nutrients_28_days"] = [NUTRIENTS[m.key].label for m in low]

    goals = conn.execute(
        "select metric, start_value, target_value from goals"
        " where user_id = %s and status = 'active' order by created_at",
        (user_id,),
    ).fetchall()
    facts["goals"] = []
    for g in goals:
        trend = [p for p in trend_points(conn, user_id, g["metric"], profile) if p.day <= week_end]
        current = trend[-1].value if trend else None
        projection = project_goal(
            start=float(g["start_value"]),
            target=float(g["target_value"]),
            current=current,
            rate_per_week=weekly_rate(trend, week_end),
            today=week_end,
            flat_threshold=METRICS[g["metric"]].flat_threshold,
        )
        facts["goals"].append(
            {
                "goal": METRICS[g["metric"]].label,
                "unit": METRICS[g["metric"]].unit,
                "target": _round(g["metric"], float(g["target_value"])),
                "current": None if current is None else _round(g["metric"], current),
                "progress_pct": projection.progress_pct,
                "state": projection.state.replace("_", " "),
                "projected_date": projection.projected_date.isoformat()
                if projection.projected_date
                else None,
            }
        )
    return facts
