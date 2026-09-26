from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth import current_user_id
from app.calculations.body import navy_body_fat_pct
from app.clock import get_now
from app.crud import delete_row, get_row, insert_row, list_rows, require, update_row
from app.db import Conn, get_conn
from app.profiles import Profile, load_profile
from app.routers.body_entries import check_not_future
from app.schemas import (
    MEASUREMENT_FIELDS,
    MeasurementIn,
    MeasurementOut,
    MeasurementPatch,
    NavyPreview,
)

router = APIRouter(prefix="/measurements", tags=["measurements"])


def _f(value: Any) -> float | None:
    return None if value is None else float(value)


def navy_for(row: Mapping[str, Any], profile: Profile | None) -> float | None:
    waist, neck, hips = _f(row.get("waist_cm")), _f(row.get("neck_cm")), _f(row.get("hips_cm"))
    if profile is None or waist is None or neck is None:
        return None
    return navy_body_fat_pct(profile.sex, profile.height_cm, waist, neck, hips)


def _out(row: dict[str, Any], profile: Profile | None) -> dict[str, Any]:
    return {**row, "navy_body_fat_pct": navy_for(row, profile)}


@router.get("/navy-preview", response_model=NavyPreview)
def navy_preview(
    waist_cm: float = Query(ge=10, le=250),
    neck_cm: float = Query(ge=10, le=250),
    hips_cm: float | None = Query(default=None, ge=10, le=250),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> NavyPreview:
    row = {"waist_cm": waist_cm, "neck_cm": neck_cm, "hips_cm": hips_cm}
    return NavyPreview(navy_body_fat_pct=navy_for(row, load_profile(conn, user_id)))


@router.get("", response_model=list[MeasurementOut])
def list_measurements(
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[dict[str, Any]]:
    profile = load_profile(conn, user_id)
    rows = list_rows(conn, "measurements", user_id, "measured_at", start, end)
    return [_out(r, profile) for r in rows]


@router.post("", response_model=MeasurementOut, status_code=201)
def create_measurement(
    body: MeasurementIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    row = insert_row(conn, "measurements", user_id, body.model_dump())
    return _out(row, load_profile(conn, user_id))


@router.patch("/{measurement_id}", response_model=MeasurementOut)
def update_measurement(
    measurement_id: UUID,
    body: MeasurementPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    existing = require(get_row(conn, "measurements", user_id, measurement_id))
    data = body.model_dump(exclude_unset=True)
    merged = {**existing, **data}
    if all(merged.get(f) is None for f in MEASUREMENT_FIELDS):
        raise HTTPException(status_code=422, detail="Enter at least one measurement")
    row = require(update_row(conn, "measurements", user_id, measurement_id, data))
    return _out(row, load_profile(conn, user_id))


@router.delete("/{measurement_id}", status_code=204)
def delete_measurement(
    measurement_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    if not delete_row(conn, "measurements", user_id, measurement_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
