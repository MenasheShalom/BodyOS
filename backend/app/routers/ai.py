from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from app.ai.factory import get_provider
from app.ai.prompts import food_photo
from app.ai.provider import AIConfigError, AIImage, AIProvider, AIRequest, MediaType
from app.ai.service import month_window, run, used_this_month
from app.ai_schemas import (
    AISettingsIn,
    AISettingsOut,
    AIStatusOut,
    FoodPhotoItemOut,
    FoodPhotoResultOut,
)
from app.auth import current_user_id
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import Conn, get_conn
from app.nutrition_schemas import validate_quick_nutrients
from app.profiles import load_profile
from app.services.series_service import UTC_ZONE

router = APIRouter(prefix="/ai", tags=["ai"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_HINT = 300


def _settings_row(conn: Conn, user_id: UUID) -> dict[str, Any]:
    row = conn.execute(
        "select enabled, acknowledged from ai_settings where user_id = %s", (user_id,)
    ).fetchone()
    return row or {"enabled": True, "acknowledged": []}


@router.get("/status", response_model=AIStatusOut)
def status(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> AIStatusOut:
    profile = load_profile(conn, user_id)
    tz = profile.tz if profile else UTC_ZONE
    provider: AIProvider | None
    try:
        provider = get_provider(settings)
    except AIConfigError:
        provider = None
    user_on = bool(_settings_row(conn, user_id)["enabled"])
    return AIStatusOut(
        enabled=provider is not None and user_on,
        configured=provider is not None,
        provider=provider.name if provider else None,
        model=provider.model if provider else None,
        used_this_month=used_this_month(conn, user_id, now, tz),
        limit=settings.ai_monthly_request_limit,
        resets_on=month_window(now, tz)[2],
    )


@router.get("/settings", response_model=AISettingsOut)
def get_ai_settings(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> dict[str, Any]:
    return _settings_row(conn, user_id)


@router.put("/settings", response_model=AISettingsOut)
def put_ai_settings(
    body: AISettingsIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> dict[str, Any]:
    row = conn.execute(
        "insert into ai_settings (user_id, enabled, acknowledged) values (%s, %s, %s)"
        " on conflict (user_id) do update set enabled = excluded.enabled,"
        " acknowledged = excluded.acknowledged returning enabled, acknowledged",
        (user_id, body.enabled, sorted(set(body.acknowledged))),
    ).fetchone()
    assert row is not None
    return row


def _media_type(data: bytes) -> MediaType:
    """Checked from the file's first bytes, not the name or the declared type."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise HTTPException(status_code=415, detail="Use a JPEG, PNG or WebP photo")


@router.post("/food-photo", response_model=FoodPhotoResultOut)
async def analyse_food_photo(
    image: UploadFile,
    hint: str | None = Form(default=None, max_length=MAX_HINT),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    provider: AIProvider | None = Depends(get_provider),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> FoodPhotoResultOut:
    """Estimates the food in a photo. Nothing is logged and the photo isn't kept."""
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Photo is too large (5 MB at most)")
    media_type = _media_type(data)
    profile = load_profile(conn, user_id)
    result = run(
        conn,
        user_id,
        provider,
        AIRequest(
            feature="food_photo",
            prompt_version=food_photo.PROMPT_VERSION,
            system=food_photo.SYSTEM,
            text=food_photo.user_text(hint.strip() if hint else None),
            schema=food_photo.FoodPhotoOut,
            images=[AIImage(data, media_type)],
        ),
        now=now,
        tz=profile.tz if profile else UTC_ZONE,
        limit=settings.ai_monthly_request_limit,
    )
    items: list[FoodPhotoItemOut] = []
    for item in result.value.items:
        try:
            nutrients = validate_quick_nutrients(
                {
                    "energy_kcal": item.energy_kcal,
                    "protein_g": item.protein_g,
                    "carbs_g": item.carbs_g,
                    "fat_g": item.fat_g,
                }
            )
        except ValueError:
            continue
        items.append(
            FoodPhotoItemOut(
                name=item.name,
                grams=round(item.grams),
                nutrients={k: round(v, 1) for k, v in nutrients.items()},
                confidence=item.confidence,
                search_query=item.search_query or item.name,
            )
        )
    return FoodPhotoResultOut(
        items=items, notes=result.value.notes, dropped=len(result.value.items) - len(items)
    )
