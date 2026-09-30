from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.nutrition_schemas import (
    ActivityLevel,
    EstimateOut,
    Mode,
    NutritionSettingsIn,
    NutritionSettingsOut,
    TargetsIn,
    TargetsOut,
)
from app.profiles import load_profile
from app.services.food_log_service import TARGET_COLUMNS, target_on
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
