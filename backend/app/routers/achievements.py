"""Achievement trophies: GET evaluates and records newly earned ones; POST marks them seen."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.profiles import load_profile
from app.services.achievement_service import BY_KEY, refresh

router = APIRouter(prefix="/achievements", tags=["achievements"])


class AchievementOut(BaseModel):
    key: str
    category: Literal["consistency", "body", "goals", "habits"]
    tier: Literal["bronze", "silver", "gold"]
    title: str
    description: str
    target: float
    unit: str
    progress: float  # towards `target`; equals it once earned
    earned_on: date | None
    new: bool  # earned but its celebration hasn't been shown yet


class SeenIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=len(BY_KEY))


@router.get("", response_model=list[AchievementOut])
def list_achievements(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[AchievementOut]:
    profile = load_profile(conn, user_id)
    if profile is None:
        return []
    out = []
    for trophy, outcome, row in refresh(conn, user_id, profile):
        out.append(
            AchievementOut(
                key=trophy.key,
                category=trophy.category,
                tier=trophy.tier,
                title=trophy.title,
                description=trophy.description,
                target=trophy.target,
                unit=trophy.unit,
                progress=trophy.target if row else outcome.progress,
                earned_on=row["earned_on"] if row else None,
                new=row is not None and row["seen_at"] is None,
            )
        )
    return out


@router.post("/seen", status_code=204)
def mark_seen(
    body: SeenIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> None:
    conn.execute(
        "update achievements set seen_at = %s"
        " where user_id = %s and key = any(%s) and seen_at is null",
        (now, user_id, body.keys),
    )
