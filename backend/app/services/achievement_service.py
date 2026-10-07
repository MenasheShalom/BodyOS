"""Trophies: the catalogue, and how each one is earned from the user's own data.

Everything is recomputed from history, so trophies earned before this feature existed are
backfilled with the day they were earned. Body milestones use the smoothed trend, not single
readings, so one lucky weigh-in doesn't count.
"""

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import cached_property
from typing import Any, Literal
from uuid import UUID

from app.calculations.achievements import (
    Outcome,
    crossed,
    drop_from_peak,
    in_window,
    nth,
    streak,
    week_streak,
)
from app.calculations.series import Point
from app.db import Conn
from app.profiles import Profile
from app.services.trend_lookup import trend_points, value_on

Category = Literal["consistency", "body", "goals", "habits"]
Tier = Literal["bronze", "silver", "gold"]

KCAL_TOLERANCE = 0.10  # within 10% of the calorie target counts as on target
LEAN_TOLERANCE_KG = 0.5


class Facts:
    """The user's history, loaded once per evaluation and only as far as it's needed."""

    def __init__(self, conn: Conn, user_id: UUID, profile: Profile) -> None:
        self.conn = conn
        self.user_id = user_id
        self.profile = profile
        self._trends: dict[str, list[Point]] = {}

    def _local(self, at: datetime) -> date:
        return at.astimezone(self.profile.tz).date()

    def _days(self, sql: str) -> list[date]:
        rows = self.conn.execute(sql, (self.user_id,)).fetchall()
        return sorted(self._local(next(iter(r.values()))) for r in rows)

    def trend(self, metric: str) -> list[Point]:
        if metric not in self._trends:
            self._trends[metric] = trend_points(self.conn, self.user_id, metric, self.profile)
        return self._trends[metric]

    @cached_property
    def weigh_days(self) -> list[date]:
        return self._days("select measured_at from body_entries where user_id = %s")

    @cached_property
    def measurement_days(self) -> list[date]:
        return self._days("select measured_at from measurements where user_id = %s")

    @cached_property
    def photo_days(self) -> list[date]:
        return self._days("select taken_at from progress_photos where user_id = %s")

    @cached_property
    def food(self) -> list[dict[str, Any]]:
        return self.conn.execute(
            "select eaten_at, nutrients, origin from food_log where user_id = %s order by eaten_at",
            (self.user_id,),
        ).fetchall()

    @cached_property
    def entry_days(self) -> list[date]:
        """One day per logged entry, in order."""
        return [self._local(r["eaten_at"]) for r in self.food]

    def origin_days(self, origin: str) -> list[date]:
        return [self._local(r["eaten_at"]) for r in self.food if r["origin"] == origin]

    @cached_property
    def day_totals(self) -> dict[date, dict[str, float]]:
        totals: dict[date, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for r in self.food:
            day = totals[self._local(r["eaten_at"])]
            for key in ("energy_kcal", "protein_g"):
                day[key] += float(r["nutrients"].get(key) or 0)
        excluded = {
            r["day"]
            for r in self.conn.execute(
                "select day from nutrition_day_flags where user_id = %s and excluded",
                (self.user_id,),
            ).fetchall()
        }
        return {d: dict(t) for d, t in totals.items() if d not in excluded}

    @cached_property
    def targets(self) -> list[dict[str, Any]]:
        return self.conn.execute(
            "select effective_from, energy_kcal, protein_g, created_at from nutrition_targets"
            " where user_id = %s order by effective_from",
            (self.user_id,),
        ).fetchall()

    def _target_on(self, day: date) -> dict[str, Any] | None:
        in_force = [t for t in self.targets if t["effective_from"] <= day]
        return in_force[-1] if in_force else None

    def days_meeting(self, test: Callable[[dict[str, float], dict[str, Any]], bool]) -> list[date]:
        out = []
        for day, totals in self.day_totals.items():
            target = self._target_on(day)
            if target is not None and test(totals, target):
                out.append(day)
        return sorted(out)

    @cached_property
    def goals(self) -> list[dict[str, Any]]:
        return self.conn.execute(
            "select metric, start_value, target_value, start_date, status, updated_at"
            " from goals where user_id = %s order by created_at",
            (self.user_id,),
        ).fetchall()

    def goal_days(self, share: float) -> list[date]:
        """For each goal, the day it got `share` of the way (1.0 = reached), sorted."""
        days = []
        for g in self.goals:
            start, target = float(g["start_value"]), float(g["target_value"])
            level = start + (target - start) * share
            day = crossed(self.trend(g["metric"]), g["start_date"], start, level)
            if share >= 1 and g["status"] == "achieved":
                marked = self._local(g["updated_at"])
                day = min(day, marked) if day else marked
            if day is not None:
                days.append(day)
        return sorted(days)

    def created_days(self, table: str) -> list[date]:
        return self._days(f"select created_at from {table} where user_id = %s")


def _muscle_keeper(f: Facts, loss_kg: float = 2.0) -> Outcome:
    """Weight trend down `loss_kg` from a peak while the lean mass trend held."""
    lean = f.trend("lean_mass_kg")
    if not lean:
        return Outcome(None, 0)
    peak: Point | None = None
    best = 0.0
    for p in f.trend("weight_kg"):
        if peak is None or p.value > peak.value:
            peak = p
        lean_then, lean_now = value_on(lean, peak.day), value_on(lean, p.day)
        fresh = any(peak.day < q.day <= p.day for q in lean)  # a body-fat reading since
        if lean_then is None or lean_now is None or not fresh:
            continue
        if lean_now >= lean_then - LEAN_TOLERANCE_KG:
            drop = peak.value - p.value
            best = max(best, drop)
            if drop >= loss_kg - 1e-9:
                return Outcome(p.day, loss_kg)
    return Outcome(None, round(best, 1))


def _distinct_weeks(days: list[date]) -> list[date]:
    """The first day of each new Monday-to-Sunday week, in order."""
    seen: set[date] = set()
    firsts = []
    for d in days:
        week = d - timedelta(days=d.weekday())
        if week not in seen:
            seen.add(week)
            firsts.append(d)
    return firsts


@dataclass(frozen=True)
class Trophy:
    key: str
    category: Category
    tier: Tier
    title: str
    description: str
    target: float
    unit: str
    evaluate: Callable[[Facts], Outcome]
    metric: str | None = None  # left out when the user hides this metric


def _protein_hit(totals: dict[str, float], target: dict[str, Any]) -> bool:
    goal = float(target["protein_g"])
    return goal > 0 and totals.get("protein_g", 0) >= goal


def _kcal_hit(totals: dict[str, float], target: dict[str, Any]) -> bool:
    goal = float(target["energy_kcal"])
    return abs(totals.get("energy_kcal", 0) - goal) <= goal * KCAL_TOLERANCE


CATALOGUE: list[Trophy] = [
    # consistency
    Trophy("weigh_streak_7", "consistency", "bronze", "Week on the scale",
           "Weigh in 7 days in a row", 7, "days", lambda f: streak(f.weigh_days, 7)),
    Trophy("weigh_streak_30", "consistency", "silver", "Month on the scale",
           "Weigh in 30 days in a row", 30, "days", lambda f: streak(f.weigh_days, 30)),
    Trophy("weigh_streak_100", "consistency", "gold", "Scale centurion",
           "Weigh in 100 days in a row", 100, "days", lambda f: streak(f.weigh_days, 100)),
    Trophy("weigh_weeks_12", "consistency", "silver", "Never miss a week",
           "Weigh in at least once a week for 12 weeks running", 12, "weeks",
           lambda f: week_streak(f.weigh_days, 12)),
    Trophy("food_streak_7", "consistency", "bronze", "Logged a week",
           "Log food 7 days in a row", 7, "days", lambda f: streak(f.entry_days, 7)),
    Trophy("food_streak_30", "consistency", "silver", "Logging habit",
           "Log food 30 days in a row", 30, "days", lambda f: streak(f.entry_days, 30)),
    Trophy("food_streak_100", "consistency", "gold", "Food diarist",
           "Log food 100 days in a row", 100, "days", lambda f: streak(f.entry_days, 100)),
    Trophy("protein_5_of_7", "consistency", "bronze", "Protein on point",
           "Reach your protein target on 5 days in a week", 5, "days",
           lambda f: in_window(f.days_meeting(_protein_hit), 5)),
    Trophy("calories_5_of_7", "consistency", "silver", "Dialled in",
           "Land within 10% of your calorie target on 5 days in a week", 5, "days",
           lambda f: in_window(f.days_meeting(_kcal_hit), 5)),
    # body milestones (trend values)
    Trophy("weight_down_1", "body", "bronze", "First kilo",
           "Trend weight 1 kg below its peak", 1, "kg",
           lambda f: drop_from_peak(f.trend("weight_kg"), 1), "weight_kg"),
    Trophy("weight_down_5", "body", "silver", "Five down",
           "Trend weight 5 kg below its peak", 5, "kg",
           lambda f: drop_from_peak(f.trend("weight_kg"), 5), "weight_kg"),
    Trophy("weight_down_10", "body", "gold", "Ten down",
           "Trend weight 10 kg below its peak", 10, "kg",
           lambda f: drop_from_peak(f.trend("weight_kg"), 10), "weight_kg"),
    Trophy("waist_down_3", "body", "bronze", "A notch tighter",
           "Waist trend 3 cm below its peak", 3, "cm",
           lambda f: drop_from_peak(f.trend("waist_cm"), 3), "waist_cm"),
    Trophy("waist_down_6", "body", "silver", "New belt",
           "Waist trend 6 cm below its peak", 6, "cm",
           lambda f: drop_from_peak(f.trend("waist_cm"), 6), "waist_cm"),
    Trophy("body_fat_down_2", "body", "bronze", "Leaner",
           "Body fat trend 2 points below its peak", 2, "points",
           lambda f: drop_from_peak(f.trend("body_fat_pct"), 2), "body_fat_pct"),
    Trophy("body_fat_down_5", "body", "gold", "Much leaner",
           "Body fat trend 5 points below its peak", 5, "points",
           lambda f: drop_from_peak(f.trend("body_fat_pct"), 5), "body_fat_pct"),
    Trophy("muscle_keeper", "body", "gold", "Muscle keeper",
           "Lose 2 kg (trend) while lean mass stays within 0.5 kg", 2, "kg",
           _muscle_keeper, "body_fat_pct"),
    # goals
    Trophy("goal_halfway", "goals", "bronze", "Halfway there",
           "Get halfway to a goal", 1, "goals", lambda f: nth(f.goal_days(0.5), 1)),
    Trophy("goal_reached_1", "goals", "silver", "Goal getter",
           "Reach a goal", 1, "goals", lambda f: nth(f.goal_days(1.0), 1)),
    Trophy("goal_reached_3", "goals", "gold", "Hat-trick",
           "Reach three goals", 3, "goals", lambda f: nth(f.goal_days(1.0), 3)),
    # app habits
    Trophy("first_weigh_in", "habits", "bronze", "First step",
           "Log your first weigh-in", 1, "weigh-ins", lambda f: nth(f.weigh_days, 1)),
    Trophy("first_measurement", "habits", "bronze", "Tape measure",
           "Log your first tape measurement", 1, "measurements",
           lambda f: nth(f.measurement_days, 1)),
    Trophy("first_photo", "habits", "bronze", "Picture this",
           "Add your first progress photo", 1, "photos", lambda f: nth(f.photo_days, 1)),
    Trophy("photo_weeks_4", "habits", "silver", "Photo diary",
           "Take progress photos in 4 different weeks", 4, "weeks",
           lambda f: nth(_distinct_weeks(f.photo_days), 4)),
    Trophy("entries_100", "habits", "bronze", "Hundred bites",
           "Log 100 foods", 100, "foods", lambda f: nth(f.entry_days, 100)),
    Trophy("entries_1000", "habits", "gold", "Thousand bites",
           "Log 1,000 foods", 1000, "foods", lambda f: nth(f.entry_days, 1000)),
    Trophy("first_recipe", "habits", "bronze", "Home cook",
           "Save your first recipe", 1, "recipes",
           lambda f: nth(f.created_days("recipes"), 1)),
    Trophy("targets_4", "habits", "silver", "Fine-tuner",
           "Set or update your nutrition targets 4 times", 4, "times",
           lambda f: nth(sorted(f.created_days("nutrition_targets")), 4)),
    Trophy("first_report", "habits", "bronze", "Read all about it",
           "Get your first weekly report", 1, "reports",
           lambda f: nth(f.created_days("ai_reports"), 1)),
    Trophy("first_plan_meal", "habits", "bronze", "Planned plate",
           "Log a meal from an AI meal plan", 1, "meals",
           lambda f: nth(f.origin_days("ai_plan"), 1)),
    Trophy("photo_logs_10", "habits", "silver", "Snap and log",
           "Log 10 foods from meal photos", 10, "foods",
           lambda f: nth(f.origin_days("ai_photo"), 10)),
]  # fmt: skip
BY_KEY = {t.key: t for t in CATALOGUE}
assert len(BY_KEY) == len(CATALOGUE)


def visible_trophies(profile: Profile) -> list[Trophy]:
    return [t for t in CATALOGUE if t.metric is None or t.metric not in profile.hidden_metrics]


def evaluate(conn: Conn, user_id: UUID, profile: Profile) -> list[tuple[Trophy, Outcome]]:
    facts = Facts(conn, user_id, profile)
    return [(t, t.evaluate(facts)) for t in visible_trophies(profile)]


def refresh(
    conn: Conn, user_id: UUID, profile: Profile
) -> list[tuple[Trophy, Outcome, dict[str, Any] | None]]:
    """Evaluates every trophy and records the newly earned ones (kept for good once earned).
    Returns each trophy with its outcome and its stored row, if earned."""
    results = evaluate(conn, user_id, profile)
    for trophy, outcome in results:
        if outcome.earned_on is not None:
            conn.execute(
                "insert into achievements (user_id, key, earned_on) values (%s, %s, %s)"
                " on conflict (user_id, key) do nothing",
                (user_id, trophy.key, outcome.earned_on),
            )
    rows = {
        r["key"]: r
        for r in conn.execute(
            "select key, earned_on, seen_at from achievements where user_id = %s", (user_id,)
        ).fetchall()
    }
    return [(t, o, rows.get(t.key)) for t, o in results]
