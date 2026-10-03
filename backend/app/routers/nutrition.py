from dataclasses import asdict
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.nutrition_schemas import (
    ActivityLevel,
    EstimateOut,
    MacroTargets,
    Mode,
    NutritionSettingsIn,
    NutritionSettingsOut,
    SuggestionOut,
    TargetsIn,
    TargetsOut,
    TdeeOut,
    TdeeWeekOut,
)
from app.profiles import load_profile
from app.services.food_log_service import TARGET_COLUMNS, target_on
from app.services.insight_service import (
    check_in_week,
    load_insight,
    owed_suggestion,
    weekly_intake,
)
from app.services.nutrition_service import NeedsData, estimate, load_settings, save_settings
from app.services.series_service import local_today

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


@router.get("/settings", response_model=NutritionSettingsOut)
def get_settings(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> NutritionSettingsOut:
    return load_settings(conn, user_id)


@router.put("/settings", response_model=NutritionSettingsOut)
def put_settings(
    body: NutritionSettingsIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> NutritionSettingsOut:
    return save_settings(conn, user_id, body)


@router.get("/estimate", response_model=EstimateOut)
def get_estimate(
    activity_level: ActivityLevel = "light",
    mode: Mode = "recomp",
    deficit_pct: float | None = Query(default=None, ge=-10, le=25),
    protein_g_per_kg: float = Query(default=2.0, ge=1.4, le=3.0),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> EstimateOut:
    profile = load_profile(conn, user_id)
    try:
        return estimate(
            conn,
            user_id,
            profile,
            local_today(now, profile),
            activity_level=activity_level,
            mode=mode,
            deficit_pct=deficit_pct,
            protein_g_per_kg=protein_g_per_kg,
        )
    except NeedsData as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/targets", response_model=list[TargetsOut])
def list_targets(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[dict[str, Any]]:
    return conn.execute(
        f"select {TARGET_COLUMNS} from nutrition_targets"
        " where user_id = %s order by effective_from desc",
        (user_id,),
    ).fetchall()


@router.get("/targets/current", response_model=TargetsOut | None)
def current_targets(
    day: date | None = None,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any] | None:
    profile = load_profile(conn, user_id)
    return target_on(conn, user_id, day or local_today(now, profile))


@router.post("/targets", response_model=TargetsOut, status_code=201)
def save_targets(
    body: TargetsIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    today = local_today(now, load_profile(conn, user_id))
    if body.effective_from > today + timedelta(days=1):
        raise HTTPException(status_code=422, detail="Targets can start today or tomorrow")
    values = body.model_dump()
    cols = ", ".join(values)
    updates = ", ".join(f"{c} = excluded.{c}" for c in values if c != "effective_from")
    row = conn.execute(
        f"insert into nutrition_targets (user_id, {cols})"
        f" values (%s, {', '.join(['%s'] * len(values))})"
        f" on conflict (user_id, effective_from) do update set {updates}"
        f" returning {TARGET_COLUMNS}",
        (user_id, *values.values()),
    ).fetchone()
    assert row is not None
    return row


@router.get("/tdee", response_model=TdeeOut)
def get_tdee(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> TdeeOut:
    profile = load_profile(conn, user_id)
    today = local_today(now, profile)
    try:
        insight = load_insight(conn, user_id, profile, today)
    except NeedsData as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    t = insight.tdee
    return TdeeOut(
        tdee=round(t.current),
        confidence=None if t.confidence is None else round(t.confidence),
        has_data=t.has_data,
        eligible_days=t.eligible_days_now,
        start_tdee=insight.start.tdee,
        check_in_weekday=insight.settings.check_in_weekday,
        weekly=[
            TdeeWeekOut(
                day=w.day,
                observed=None if w.observed is None else round(w.observed),
                tdee=round(w.smoothed),
                intake=(
                    None if (i := weekly_intake(insight.eligible, w.day)) is None else round(i)
                ),
            )
            for w in t.weekly
        ],
    )


@router.get("/suggestion", response_model=SuggestionOut | None)
def get_suggestion(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> SuggestionOut | None:
    """This week's check-in, or null when nothing is owed."""
    profile = load_profile(conn, user_id)
    today = local_today(now, profile)
    try:
        insight = load_insight(conn, user_id, profile, today)
    except NeedsData:
        return None
    assert profile is not None
    owed = owed_suggestion(conn, user_id, profile, insight, today)
    if owed is None:
        return None
    t = insight.tdee
    return SuggestionOut(
        week_start=owed.week_start,
        tdee=round(t.current),
        confidence=None if t.confidence is None else round(t.confidence),
        targets=MacroTargets(**asdict(owed.suggestion.targets)),
        current=None if owed.current is None else MacroTargets(**asdict(owed.current)),
        capped=owed.suggestion.capped,
        warning=owed.suggestion.warning,
    )


@router.post("/suggestion/dismiss", status_code=204)
def dismiss_suggestion(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> Response:
    """Hide this week's check-in (the "Not this week" button)."""
    profile = load_profile(conn, user_id)
    settings = load_settings(conn, user_id)
    week_start = check_in_week(local_today(now, profile), settings.check_in_weekday)
    conn.execute(
        "insert into target_suggestion_dismissals (user_id, week_start) values (%s, %s)"
        " on conflict do nothing",
        (user_id, week_start),
    )
    return Response(status_code=204)
