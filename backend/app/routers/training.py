"""Training: equipment locations, the training profile, AI-built programs and logged sessions."""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.ai.factory import get_provider
from app.ai.prompts import workout_plan
from app.ai.provider import AIProvider, AIRequest
from app.ai.service import run
from app.auth import current_user_id
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import Conn, get_conn
from app.profiles import load_profile
from app.services.series_service import local_today
from app.services.workout_service import (
    PROGRAM_COLUMNS,
    SESSION_COLUMNS,
    active_program_row,
    next_day,
    owned_day,
    profile_facts,
    program_out,
    save_program,
    session_out,
    today_exercise,
)
from app.workout_schemas import (
    DayPatch,
    EquipmentOut,
    GenerateIn,
    LocationIn,
    LocationOut,
    ProgramOut,
    SessionIn,
    SessionOut,
    SessionSummaryOut,
    SetsIn,
    SwapIn,
    TodayOut,
    TrainingProfileIn,
    TrainingProfileOut,
)
from app.workouts.equipment import EQUIPMENT

router = APIRouter(prefix="/training", tags=["training"])

LOCATION_COLUMNS = "id, name, equipment, notes"
PROFILE_FIELDS = ("experience", "limitations", "days_per_week", "session_minutes", "cardio")
MAX_LOCATIONS = 6


@router.get("/equipment", response_model=list[EquipmentOut])
def equipment() -> list[EquipmentOut]:
    return [EquipmentOut(key=k, label=v) for k, v in EQUIPMENT.items()]


# --- locations --------------------------------------------------------------------------------


@router.get("/locations", response_model=list[LocationOut])
def list_locations(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[dict[str, Any]]:
    return conn.execute(
        f"select {LOCATION_COLUMNS} from training_locations where user_id = %s order by created_at",
        (user_id,),
    ).fetchall()


@router.post("/locations", response_model=LocationOut, status_code=201)
def create_location(
    body: LocationIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> dict[str, Any]:
    count = conn.execute(
        "select count(*) as n from training_locations where user_id = %s", (user_id,)
    ).fetchone()
    assert count is not None
    if count["n"] >= MAX_LOCATIONS:
        raise HTTPException(status_code=422, detail=f"Up to {MAX_LOCATIONS} locations")
    row = conn.execute(
        "insert into training_locations (user_id, name, equipment, notes) values (%s, %s, %s, %s)"
        f" returning {LOCATION_COLUMNS}",
        (user_id, body.name, body.equipment, body.notes),
    ).fetchone()
    assert row is not None
    return row


@router.put("/locations/{location_id}", response_model=LocationOut)
def update_location(
    location_id: UUID,
    body: LocationIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> dict[str, Any]:
    row = conn.execute(
        "update training_locations set name = %s, equipment = %s, notes = %s"
        f" where id = %s and user_id = %s returning {LOCATION_COLUMNS}",
        (body.name, body.equipment, body.notes, location_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(
    location_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    deleted = conn.execute(
        "delete from training_locations where id = %s and user_id = %s", (location_id, user_id)
    ).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)


# --- profile ----------------------------------------------------------------------------------


def _training_profile(conn: Conn, user_id: UUID) -> TrainingProfileOut:
    row = conn.execute(
        f"select {', '.join(PROFILE_FIELDS)} from training_profiles where user_id = %s",
        (user_id,),
    ).fetchone()
    return (
        TrainingProfileOut(**row, configured=True) if row else TrainingProfileOut(configured=False)
    )


@router.get("/profile", response_model=TrainingProfileOut)
def get_training_profile(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> TrainingProfileOut:
    return _training_profile(conn, user_id)


@router.put("/profile", response_model=TrainingProfileOut)
def put_training_profile(
    body: TrainingProfileIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> TrainingProfileOut:
    values = body.model_dump()
    conn.execute(
        f"insert into training_profiles (user_id, {', '.join(values)})"
        f" values (%s, {', '.join(['%s'] * len(values))})"
        f" on conflict (user_id) do update set {', '.join(f'{k} = excluded.{k}' for k in values)}",
        (user_id, *values.values()),
    )
    return _training_profile(conn, user_id)


# --- programs ---------------------------------------------------------------------------------


@router.post("/programs", response_model=ProgramOut, status_code=201)
def generate_program(
    body: GenerateIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    provider: AIProvider | None = Depends(get_provider),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> ProgramOut:
    """Asks the AI for a program and saves it as the active one."""
    profile = load_profile(conn, user_id)
    if profile is None:
        raise HTTPException(status_code=409, detail="Set up your profile first")
    training = _training_profile(conn, user_id)
    if not training.configured:
        raise HTTPException(status_code=409, detail="Set up your training profile first")
    ids = list(dict.fromkeys(body.location_ids))
    rows = conn.execute(
        f"select {LOCATION_COLUMNS} from training_locations where user_id = %s and id = any(%s)",
        (user_id, ids),
    ).fetchall()
    if len(rows) != len(ids):
        raise HTTPException(status_code=404, detail="Location not found")
    locations = sorted(rows, key=lambda r: ids.index(r["id"]))

    today = local_today(now, profile)
    facts = profile_facts(conn, user_id, profile, today, training, locations)
    result = run(
        conn,
        user_id,
        provider,
        AIRequest(
            feature="workout_plan",
            prompt_version=workout_plan.PROMPT_VERSION,
            system=workout_plan.SYSTEM,
            text=workout_plan.user_text(
                facts, training.limitations, [loc["notes"] for loc in locations]
            ),
            schema=workout_plan.WorkoutPlanOut,
            max_output_tokens=8000,
        ),
        now=now,
        tz=profile.tz,
        limit=settings.ai_monthly_request_limit,
    )
    inputs = {**facts, "limitations": training.limitations}
    program_id = save_program(
        conn,
        user_id,
        result.value,
        locations,
        inputs,
        (provider.name if provider else "", result.model, workout_plan.PROMPT_VERSION),
        today,
    )
    row = conn.execute(
        f"select {PROGRAM_COLUMNS} from workout_programs where id = %s", (program_id,)
    ).fetchone()
    assert row is not None
    return program_out(conn, row)


@router.get("/programs/active", response_model=ProgramOut | None)
def get_active_program(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> ProgramOut | None:
    row = active_program_row(conn, user_id)
    return program_out(conn, row) if row else None


@router.delete("/programs/active", status_code=204)
def end_active_program(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    conn.execute(
        "update workout_programs set active = false where user_id = %s and active", (user_id,)
    )
    return Response(status_code=204)


@router.patch("/program-days/{day_id}", response_model=ProgramOut)
def move_day(
    day_id: UUID,
    body: DayPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> ProgramOut:
    """Changes where a day is trained. The exercises stay; swap any that don't fit."""
    day = owned_day(conn, user_id, day_id)
    if (
        body.location_id is not None
        and not conn.execute(
            "select 1 from training_locations where id = %s and user_id = %s",
            (body.location_id, user_id),
        ).fetchone()
    ):
        raise HTTPException(status_code=404, detail="Location not found")
    conn.execute(
        "update program_days set location_id = %s where id = %s", (body.location_id, day_id)
    )
    row = conn.execute(
        f"select {PROGRAM_COLUMNS} from workout_programs where id = %s", (day["program_id"],)
    ).fetchone()
    assert row is not None
    return program_out(conn, row)


@router.post("/program-exercises/{exercise_id}/swap", response_model=ProgramOut)
def swap_exercise(
    exercise_id: UUID,
    body: SwapIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> ProgramOut:
    """Replaces an exercise with one of its alternatives; the old one becomes an alternative."""
    ex = conn.execute(
        "select e.name, e.alternatives, d.program_id from program_exercises e"
        " join program_days d on d.id = e.day_id where e.id = %s and e.user_id = %s",
        (exercise_id, user_id),
    ).fetchone()
    if ex is None:
        raise HTTPException(status_code=404, detail="Not found")
    if body.name not in ex["alternatives"]:
        raise HTTPException(status_code=422, detail="Choose one of the alternatives")
    alternatives = [a for a in ex["alternatives"] if a != body.name] + [ex["name"]]
    conn.execute(
        "update program_exercises set name = %s, alternatives = %s where id = %s",
        (body.name, alternatives[:3], exercise_id),
    )
    row = conn.execute(
        f"select {PROGRAM_COLUMNS} from workout_programs where id = %s", (ex["program_id"],)
    ).fetchone()
    assert row is not None
    return program_out(conn, row)


# --- following the program ----------------------------------------------------------------------


def _open_session(conn: Conn, user_id: UUID, today: date) -> dict[str, Any] | None:
    return conn.execute(
        f"select {SESSION_COLUMNS} from workout_sessions"
        " where user_id = %s and performed_on = %s and completed_at is null"
        " order by created_at desc limit 1",
        (user_id, today),
    ).fetchone()


@router.get("/today", response_model=TodayOut | None)
def today_workout(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> TodayOut | None:
    """The workout to do next (or the one under way today), with targets from last time."""
    row = active_program_row(conn, user_id)
    if row is None:
        return None
    program = program_out(conn, row)
    profile = load_profile(conn, user_id)
    today = local_today(now, profile)
    session = _open_session(conn, user_id, today)
    day = next((d for d in program.days if session and d.id == session["program_day_id"]), None)
    day = day or next_day(conn, user_id, program)
    done = conn.execute(
        "select count(*) as n from workout_sessions s join program_days d on d.id = s.program_day_id"
        " where s.user_id = %s and d.program_id = %s and s.completed_at is not null",
        (user_id, program.id),
    ).fetchone()
    assert done is not None
    return TodayOut(
        day=day,
        week=max(1, (today - program.started_on).days // 7 + 1),
        session=session_out(conn, session) if session else None,
        exercises=[
            today_exercise(conn, user_id, ex, session["id"] if session else None)
            for ex in day.exercises
        ],
        sessions_done=done["n"],
    )


@router.post("/sessions", response_model=SessionOut, status_code=201)
def start_session(
    body: SessionIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> SessionOut:
    """Starts today's session for a program day, or returns the one already under way."""
    day = owned_day(conn, user_id, body.program_day_id)
    today = local_today(now, load_profile(conn, user_id))
    session = _open_session(conn, user_id, today)
    if session is None or session["program_day_id"] != day["id"]:
        if session is not None:  # switching days: drop the empty or abandoned one
            conn.execute("delete from workout_sessions where id = %s", (session["id"],))
        session = conn.execute(
            "insert into workout_sessions (user_id, program_day_id, day_name, performed_on)"
            f" values (%s, %s, %s, %s) returning {SESSION_COLUMNS}",
            (user_id, day["id"], day["name"], today),
        ).fetchone()
    assert session is not None
    return session_out(conn, session)


def _owned_session(conn: Conn, user_id: UUID, session_id: UUID) -> dict[str, Any]:
    row = conn.execute(
        f"select {SESSION_COLUMNS} from workout_sessions where id = %s and user_id = %s",
        (session_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.put("/sessions/{session_id}/sets", response_model=SessionOut)
def save_sets(
    session_id: UUID,
    body: SetsIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> SessionOut:
    """Replaces the session's logged sets (sent whole after each change)."""
    session = _owned_session(conn, user_id, session_id)
    keys = [(s.exercise_name.lower(), s.set_number) for s in body.sets]
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=422, detail="Each set can be logged once")
    conn.execute("delete from session_sets where session_id = %s", (session_id,))
    for s in body.sets:
        conn.execute(
            "insert into session_sets (session_id, user_id, exercise_id, exercise_name,"
            " set_number, weight_kg, reps, seconds) values (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                session_id,
                user_id,
                s.exercise_id,
                s.exercise_name,
                s.set_number,
                s.weight_kg,
                s.reps,
                s.seconds,
            ),
        )
    conn.execute("update workout_sessions set notes = %s where id = %s", (body.notes, session_id))
    return session_out(conn, {**session, "notes": body.notes})


@router.post("/sessions/{session_id}/complete", response_model=SessionOut)
def complete_session(
    session_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> SessionOut:
    _owned_session(conn, user_id, session_id)
    row = conn.execute(
        "update workout_sessions set completed_at = coalesce(completed_at, %s)"
        f" where id = %s returning {SESSION_COLUMNS}",
        (now, session_id),
    ).fetchone()
    assert row is not None
    return session_out(conn, row)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(
    session_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    _owned_session(conn, user_id, session_id)
    conn.execute("delete from workout_sessions where id = %s", (session_id,))
    return Response(status_code=204)


@router.get("/sessions", response_model=list[SessionSummaryOut])
def list_sessions(
    limit: int = Query(default=30, ge=1, le=200),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[dict[str, Any]]:
    """Completed sessions, newest first."""
    return conn.execute(
        "select s.id, s.day_name, s.performed_on, s.completed_at,"
        " count(x.id) filter (where coalesce(x.reps, x.seconds, 0) > 0) as sets_done,"
        " coalesce(sum(x.weight_kg * x.reps), 0)::float as volume_kg"
        " from workout_sessions s left join session_sets x on x.session_id = s.id"
        " where s.user_id = %s and s.completed_at is not null"
        " group by s.id order by s.performed_on desc, s.completed_at desc limit %s",
        (user_id, limit),
    ).fetchall()
