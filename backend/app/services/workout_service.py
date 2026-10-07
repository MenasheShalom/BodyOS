"""Training programs: the facts the AI builds a program from, saving it, and following it."""

from datetime import date
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.ai.prompts.workout_plan import WorkoutPlanOut
from app.calculations.nutrition import age_on
from app.calculations.progression import DoneSet, Spec, suggest
from app.db import Conn
from app.profiles import Profile
from app.services.trend_lookup import trend_points
from app.workout_schemas import (
    ExerciseOut,
    ProgramDayOut,
    ProgramOut,
    SessionOut,
    SetOut,
    SuggestionOut,
    TodayExerciseOut,
    TrainingProfileIn,
)
from app.workouts.equipment import EQUIPMENT

PROGRAM_COLUMNS = "id, name, summary, weeks, daily_steps, started_on, created_at"
EXERCISE_COLUMNS = (
    "id, position, name, kind, sets, reps_low, reps_high, seconds, rest_seconds, uses_weight,"
    " notes, alternatives"
)
SESSION_COLUMNS = "id, program_day_id, day_name, performed_on, completed_at, notes"


def _latest(conn: Conn, user_id: UUID, metric: str, profile: Profile) -> float | None:
    trend = trend_points(conn, user_id, metric, profile)
    return round(trend[-1].value, 1) if trend else None


def profile_facts(
    conn: Conn,
    user_id: UUID,
    profile: Profile,
    today: date,
    training: TrainingProfileIn,
    locations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Everything the program is built from, as plain JSON (also stored with the program)."""
    settings = conn.execute(
        "select mode, deficit_pct from nutrition_settings where user_id = %s", (user_id,)
    ).fetchone()
    goals = conn.execute(
        "select metric, target_value from goals where user_id = %s and status = 'active'",
        (user_id,),
    ).fetchall()
    return {
        "sex": profile.sex,
        "age": age_on(profile.date_of_birth, today),
        "height_cm": float(profile.height_cm),
        "weight_kg_trend": _latest(conn, user_id, "weight_kg", profile),
        "body_fat_pct_trend": _latest(conn, user_id, "body_fat_pct", profile),
        "lean_mass_kg_trend": _latest(conn, user_id, "lean_mass_kg", profile),
        "nutrition_phase": settings["mode"] if settings else None,
        "calorie_deficit_pct": float(settings["deficit_pct"])
        if settings and settings["deficit_pct"] is not None
        else None,
        "goals": [{"metric": g["metric"], "target": float(g["target_value"])} for g in goals],
        "experience": training.experience,
        "days_per_week": training.days_per_week,
        "session_minutes": training.session_minutes,
        "cardio": training.cardio,
        "locations": [
            {
                "index": i,
                "name": loc["name"],
                "equipment": ["Bodyweight"] + [EQUIPMENT[e] for e in loc["equipment"]],
            }
            for i, loc in enumerate(locations)
        ],
    }


def save_program(
    conn: Conn,
    user_id: UUID,
    plan: WorkoutPlanOut,
    locations: list[dict[str, Any]],
    inputs: dict[str, Any],
    meta: tuple[str, str, str],
    today: date,
) -> UUID:
    """Stores the plan as the active program; the previous one is kept, inactive."""
    conn.execute(
        "update workout_programs set active = false where user_id = %s and active", (user_id,)
    )
    provider, model, version = meta
    row = conn.execute(
        "insert into workout_programs (user_id, name, summary, weeks, daily_steps, started_on,"
        " inputs, provider, model, prompt_version)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
        (
            user_id,
            plan.name,
            plan.summary,
            plan.weeks,
            plan.daily_steps or None,
            today,
            Jsonb(inputs),
            provider,
            model[:120],
            version,
        ),
    ).fetchone()
    assert row is not None
    for d_pos, day in enumerate(plan.days):
        # A location index the model made up falls back to the first location.
        location = locations[day.location] if day.location < len(locations) else locations[0]
        day_row = conn.execute(
            "insert into program_days (program_id, user_id, position, name, focus, location_id,"
            " cardio) values (%s, %s, %s, %s, %s, %s, %s) returning id",
            (row["id"], user_id, d_pos, day.name, day.focus, location["id"], day.cardio),
        ).fetchone()
        assert day_row is not None
        for e_pos, ex in enumerate(day.exercises):
            timed = ex.kind == "time"
            low, high = sorted((max(ex.reps_low, 1), max(ex.reps_high, 1)))
            conn.execute(
                "insert into program_exercises (day_id, user_id, position, name, kind, sets,"
                " reps_low, reps_high, seconds, rest_seconds, uses_weight, notes, alternatives)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    day_row["id"],
                    user_id,
                    e_pos,
                    ex.name,
                    ex.kind,
                    ex.sets,
                    None if timed else low,
                    None if timed else high,
                    max(ex.seconds, 5) if timed else None,
                    ex.rest_seconds,
                    ex.uses_weight and not timed,
                    ex.notes,
                    [a for a in ex.alternatives if a.lower() != ex.name.lower()][:3],
                ),
            )
    program_id: UUID = row["id"]
    return program_id


def active_program_row(conn: Conn, user_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        f"select {PROGRAM_COLUMNS} from workout_programs where user_id = %s and active",
        (user_id,),
    ).fetchone()


def program_out(conn: Conn, program: dict[str, Any]) -> ProgramOut:
    days = conn.execute(
        "select d.id, d.position, d.name, d.focus, d.location_id, l.name as location_name,"
        " d.cardio from program_days d left join training_locations l on l.id = d.location_id"
        " where d.program_id = %s order by d.position",
        (program["id"],),
    ).fetchall()
    exercises = conn.execute(
        f"select day_id, {EXERCISE_COLUMNS} from program_exercises"
        " where day_id = any(%s) order by position",
        ([d["id"] for d in days],),
    ).fetchall()
    return ProgramOut(
        **program,
        days=[
            ProgramDayOut(
                **d,
                exercises=[ExerciseOut(**e) for e in exercises if e["day_id"] == d["id"]],
            )
            for d in days
        ],
    )


def owned_day(conn: Conn, user_id: UUID, day_id: UUID) -> dict[str, Any]:
    day = conn.execute(
        "select id, program_id, name from program_days where id = %s and user_id = %s",
        (day_id, user_id),
    ).fetchone()
    if day is None:
        raise HTTPException(status_code=404, detail="Not found")
    return day


def next_day(conn: Conn, user_id: UUID, program: ProgramOut) -> ProgramDayOut:
    """The day after the last completed session of this program, in rotation."""
    last = conn.execute(
        "select d.position from workout_sessions s join program_days d on d.id = s.program_day_id"
        " where s.user_id = %s and d.program_id = %s and s.completed_at is not null"
        " order by s.completed_at desc, s.created_at desc limit 1",
        (user_id, program.id),
    ).fetchone()
    position = 0 if last is None else (int(last["position"]) + 1) % len(program.days)
    return program.days[position]


def set_out(row: dict[str, Any]) -> SetOut:
    return SetOut(
        exercise_id=row["exercise_id"],
        exercise_name=row["exercise_name"],
        set_number=row["set_number"],
        weight_kg=float(row["weight_kg"]) if row["weight_kg"] is not None else None,
        reps=row["reps"],
        seconds=row["seconds"],
    )


def session_out(conn: Conn, session: dict[str, Any]) -> SessionOut:
    rows = conn.execute(
        "select exercise_id, exercise_name, set_number, weight_kg, reps, seconds"
        " from session_sets where session_id = %s order by exercise_name, set_number",
        (session["id"],),
    ).fetchall()
    return SessionOut(**session, sets=[set_out(r) for r in rows])


def last_sets(
    conn: Conn, user_id: UUID, exercise_name: str, before_session: UUID | None
) -> list[SetOut]:
    """The sets of this exercise (matched by name) in the latest completed session."""
    last = conn.execute(
        "select s.id from workout_sessions s"
        " where s.user_id = %s and s.completed_at is not null and s.id is distinct from %s"
        "   and exists (select 1 from session_sets x where x.session_id = s.id"
        "               and lower(x.exercise_name) = lower(%s))"
        " order by s.completed_at desc, s.created_at desc limit 1",
        (user_id, before_session, exercise_name),
    ).fetchone()
    if last is None:
        return []
    rows = conn.execute(
        "select exercise_id, exercise_name, set_number, weight_kg, reps, seconds"
        " from session_sets where session_id = %s and lower(exercise_name) = lower(%s)"
        " order by set_number",
        (last["id"], exercise_name),
    ).fetchall()
    return [set_out(r) for r in rows]


def today_exercise(
    conn: Conn, user_id: UUID, ex: ExerciseOut, session_id: UUID | None
) -> TodayExerciseOut:
    last = last_sets(conn, user_id, ex.name, session_id)
    spec = Spec(ex.kind, ex.sets, ex.reps_low, ex.reps_high, ex.seconds, ex.uses_weight)
    s = suggest(spec, [DoneSet(x.weight_kg, x.reps, x.seconds) for x in last])
    return TodayExerciseOut(
        exercise=ex,
        suggestion=SuggestionOut(
            weight_kg=s.weight_kg, reps=s.reps, seconds=s.seconds, note=s.note
        ),
        last=last,
    )
