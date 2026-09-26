from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.profiles import load_profile
from app.schemas import DashboardOut
from app.services.dashboard_service import build_dashboard

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
def get_dashboard(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    return build_dashboard(conn, user_id, load_profile(conn, user_id), now)
