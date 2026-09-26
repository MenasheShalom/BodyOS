from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.metrics import METRICS
from app.profiles import load_profile
from app.schemas import SeriesOut, series_out
from app.services.series_service import RangeKey, local_today, series_for

router = APIRouter(tags=["series"])


@router.get("/series", response_model=SeriesOut)
def get_series(
    metric: str,
    range_key: RangeKey = Query(default="3M", alias="range"),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> SeriesOut:
    if metric not in METRICS:
        raise HTTPException(status_code=422, detail="Unknown metric")
    profile = load_profile(conn, user_id)
    result = series_for(conn, user_id, metric, profile, range_key, local_today(now, profile))
    return series_out(result)
