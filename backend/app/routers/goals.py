from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import current_user_id
from app.clock import get_now
from app.crud import delete_row, insert_row, list_rows, require, update_row
from app.db import Conn, get_conn
from app.metrics import METRICS
from app.profiles import load_profile
from app.schemas import GoalIn, GoalOut, GoalPatch, GoalStatus
from app.services.goal_service import goal_with_projection
from app.services.series_service import local_today, series_for

router = APIRouter(prefix="/goals", tags=["goals"])


def _conflict(metric: str | None = None) -> HTTPException:
    label = METRICS[metric].label if metric else "this metric"
    return HTTPException(status_code=409, detail=f"You already have an active goal for {label}")


@router.get("", response_model=list[GoalOut])
def list_goals(
    status: GoalStatus | None = None,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> list[dict[str, Any]]:
    profile = load_profile(conn, user_id)
    today = local_today(now, profile)
    filters = {"status": status} if status else None
    rows = list_rows(conn, "goals", user_id, "start_date", filters=filters)
    return [goal_with_projection(conn, user_id, r, profile, today) for r in rows]


@router.post("", response_model=GoalOut, status_code=201)
def create_goal(
    body: GoalIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    profile = load_profile(conn, user_id)
    today = local_today(now, profile)
    current = series_for(conn, user_id, body.metric, profile, "ALL", today).latest
    if current is None:
        label = METRICS[body.metric].label
        raise HTTPException(
            status_code=422, detail=f"Log at least one {label} reading before setting this goal"
        )
    data = {
        "metric": body.metric,
        "start_value": round(current, 2),
        "target_value": body.target_value,
        "start_date": today,
        "target_date": body.target_date,
        "status": "active",
    }
    try:
        row = insert_row(conn, "goals", user_id, data)
    except psycopg.errors.UniqueViolation as exc:
        raise _conflict(body.metric) from exc
    return goal_with_projection(conn, user_id, row, profile, today)


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(
    goal_id: UUID,
    body: GoalPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    profile = load_profile(conn, user_id)
    try:
        row = update_row(conn, "goals", user_id, goal_id, body.model_dump(exclude_unset=True))
    except psycopg.errors.UniqueViolation as exc:
        raise _conflict() from exc
    return goal_with_projection(conn, user_id, require(row), profile, local_today(now, profile))


@router.delete("/{goal_id}", status_code=204)
def delete_goal(
    goal_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    if not delete_row(conn, "goals", user_id, goal_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
