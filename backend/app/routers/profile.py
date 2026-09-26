from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.auth import current_user_id
from app.db import Conn, get_conn
from app.profiles import load_profile
from app.schemas import ProfileIn, ProfileOut

router = APIRouter(prefix="/me", tags=["profile"])


@router.get("/profile", response_model=ProfileOut)
def get_profile(
    user_id: UUID = Depends(current_user_id), conn: Conn = Depends(get_conn, scope="function")
) -> ProfileOut:
    profile = load_profile(conn, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not set up")
    return ProfileOut.model_validate(asdict(profile))


@router.put("/profile", response_model=ProfileOut)
def put_profile(
    body: ProfileIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> ProfileOut:
    conn.execute(
        """
        insert into profiles (user_id, height_cm, sex, date_of_birth, timezone, hidden_metrics)
        values (%s, %s, %s, %s, %s, %s::text[])
        on conflict (user_id) do update set
          height_cm = excluded.height_cm,
          sex = excluded.sex,
          date_of_birth = excluded.date_of_birth,
          timezone = excluded.timezone,
          hidden_metrics = excluded.hidden_metrics
        """,
        (
            user_id,
            body.height_cm,
            body.sex,
            body.date_of_birth,
            body.timezone,
            list(body.hidden_metrics),
        ),
    )
    profile = load_profile(conn, user_id)
    assert profile is not None
    return ProfileOut.model_validate(asdict(profile))
