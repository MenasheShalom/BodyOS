"""AI reports and body-fat estimates (spec §5.2–5.3)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response

from app.ai.factory import get_provider
from app.ai.prompts import body_fat
from app.ai.provider import AIImage, AIProvider, AIRequest, sniff_media_type
from app.ai.service import run
from app.ai_schemas import BodyFatEstimateOut, BodyFatIn
from app.auth import current_user_id
from app.calculations.nutrition import age_on
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import Conn, get_conn
from app.profiles import load_profile
from app.services.trend_lookup import trend_points, value_on
from app.storage import PhotoStorage, get_storage

router = APIRouter(prefix="/ai", tags=["ai"])

POSE_ORDER = {"front": 0, "side": 1, "back": 2}
ESTIMATE_COLUMNS = "id, taken_on, photo_ids, low_pct, estimate_pct, high_pct, notes, created_at"


@router.get("/body-fat", response_model=list[BodyFatEstimateOut])
def list_body_fat(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[dict[str, Any]]:
    return conn.execute(
        f"select {ESTIMATE_COLUMNS} from ai_body_fat_estimates where user_id = %s"
        " order by taken_on desc, created_at desc",
        (user_id,),
    ).fetchall()


@router.post("/body-fat", response_model=BodyFatEstimateOut, status_code=201)
def estimate_body_fat(
    body: BodyFatIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    provider: AIProvider | None = Depends(get_provider),
    storage: PhotoStorage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    """Sends the chosen progress photos to the AI provider, only when the user asks."""
    profile = load_profile(conn, user_id)
    if profile is None:
        raise HTTPException(status_code=409, detail="Set up your profile first")
    ids = list(dict.fromkeys(body.photo_ids))
    photos = conn.execute(
        "select id, taken_at, pose, storage_path from progress_photos"
        " where user_id = %s and id = any(%s)",
        (user_id, ids),
    ).fetchall()
    if len(photos) != len(ids):
        raise HTTPException(status_code=404, detail="Photo not found")
    days = {p["taken_at"].astimezone(profile.tz).date() for p in photos}
    if len(days) > 1:
        raise HTTPException(status_code=422, detail="Choose photos taken on the same day")
    taken_on = days.pop()
    photos.sort(key=lambda p: POSE_ORDER[p["pose"]])

    images = []
    for p in photos:
        data = storage.download(p["storage_path"])
        media_type = sniff_media_type(data)
        if media_type is None:
            raise HTTPException(status_code=422, detail="One of the photos couldn't be read")
        images.append(AIImage(data, media_type))

    weight = value_on(trend_points(conn, user_id, "weight_kg", profile), taken_on)
    result = run(
        conn,
        user_id,
        provider,
        AIRequest(
            feature="body_fat",
            prompt_version=body_fat.PROMPT_VERSION,
            system=body_fat.SYSTEM,
            text=body_fat.user_text(
                sex=profile.sex,
                age=age_on(profile.date_of_birth, taken_on),
                height_cm=profile.height_cm,
                weight_kg=weight,
                poses=[p["pose"] for p in photos],
            ),
            schema=body_fat.BodyFatOut,
            images=images,
            max_output_tokens=1000,
        ),
        now=now,
        tz=profile.tz,
        limit=settings.ai_monthly_request_limit,
    )
    low, mid, high = body_fat.tidy_range(result.value)
    row = conn.execute(
        "insert into ai_body_fat_estimates (user_id, taken_on, photo_ids, low_pct,"
        " estimate_pct, high_pct, notes, provider, model, prompt_version)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        f" returning {ESTIMATE_COLUMNS}",
        (
            user_id,
            taken_on,
            [p["id"] for p in photos],
            low,
            mid,
            high,
            result.value.notes,
            provider.name if provider else "",
            result.model,
            body_fat.PROMPT_VERSION,
        ),
    ).fetchone()
    assert row is not None
    return row


@router.delete("/body-fat/{estimate_id}", status_code=204)
def delete_body_fat(
    estimate_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    cur = conn.execute(
        "delete from ai_body_fat_estimates where id = %s and user_id = %s", (estimate_id, user_id)
    )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
