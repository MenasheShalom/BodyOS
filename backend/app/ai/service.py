"""Runs an AI request for a user: settings and monthly limit first, one retry on invalid
output, and one `ai_usage` row per request (spec §2, §4.1)."""

import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from app.ai.provider import (
    AIConfigError,
    AIError,
    AIInvalidOutput,
    AIProvider,
    AIRefused,
    AIRequest,
    AIResult,
    AIUnavailable,
    Feature,
    T,
)
from app.db import Conn

logger = logging.getLogger("bodyos.ai")

FEATURES: tuple[Feature, ...] = (
    "food_photo",
    "weekly_report",
    "body_fat",
    "meal_plan",
    "recipe_from_groceries",
    "workout_plan",
)
# Outages and requests turned away at the limit don't use up the month's quota.
COUNTED = ("ok", "refused", "invalid_output")


class AIDisabled(Exception):
    """AI is not configured on the server, or the user switched it off."""


class AILimit(Exception):
    def __init__(self, resets_on: date) -> None:
        super().__init__(f"AI limit reached until {resets_on}")
        self.resets_on = resets_on


def ai_enabled_for_user(conn: Conn, user_id: UUID) -> bool:
    row = conn.execute("select enabled from ai_settings where user_id = %s", (user_id,)).fetchone()
    return True if row is None else bool(row["enabled"])


def month_window(now: datetime, tz: ZoneInfo) -> tuple[datetime, datetime, date]:
    """Start and end (UTC) of the calendar month containing `now` in `tz`, and the first day
    of the next month, when the limit resets."""
    today = now.astimezone(tz).date()
    first = today.replace(day=1)
    next_first = (first + timedelta(days=32)).replace(day=1)
    start = datetime.combine(first, time(), tz).astimezone(UTC)
    end = datetime.combine(next_first, time(), tz).astimezone(UTC)
    return start, end, next_first


def used_this_month(conn: Conn, user_id: UUID, now: datetime, tz: ZoneInfo) -> int:
    start, end, _ = month_window(now, tz)
    row = conn.execute(
        "select count(*) as n from ai_usage where user_id = %s and created_at >= %s"
        " and created_at < %s and outcome = any(%s)",
        (user_id, start, end, list(COUNTED)),
    ).fetchone()
    assert row is not None
    return int(row["n"])


def _record(
    conn: Conn,
    user_id: UUID,
    provider: AIProvider,
    request: AIRequest[Any],
    now: datetime,
    outcome: str,
    result: AIResult[Any] | None = None,
    latency_ms: int = 0,
) -> None:
    conn.execute(
        "insert into ai_usage (user_id, feature, provider, model, prompt_version, input_tokens,"
        " output_tokens, latency_ms, outcome, created_at)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            user_id,
            request.feature,
            provider.name,
            result.model if result else provider.model,
            request.prompt_version,
            result.usage.input_tokens if result else None,
            result.usage.output_tokens if result else None,
            result.latency_ms if result else latency_ms,
            outcome,
            now,
        ),
    )
    # Committed straight away so a failed request still counts, whatever the caller does next.
    conn.commit()


def run(
    conn: Conn,
    user_id: UUID,
    provider: AIProvider | None,
    request: AIRequest[T],
    *,
    now: datetime,
    tz: ZoneInfo,
    limit: int,
) -> AIResult[T]:
    if provider is None or not ai_enabled_for_user(conn, user_id):
        raise AIDisabled
    if used_this_month(conn, user_id, now, tz) >= limit:
        _record(conn, user_id, provider, request, now, "over_limit")
        raise AILimit(month_window(now, tz)[2])
    for attempt in (1, 2):
        try:
            result = provider.generate(request)
        except AIInvalidOutput:
            if attempt == 1:
                logger.warning("AI output invalid, retrying feature=%s", request.feature)
                continue
            _record(conn, user_id, provider, request, now, "invalid_output")
            raise
        except AIRefused:
            _record(conn, user_id, provider, request, now, "refused")
            raise
        except AIUnavailable as e:
            logger.warning("AI provider unavailable provider=%s: %s", provider.name, e)
            _record(conn, user_id, provider, request, now, "unavailable")
            raise
        except AIConfigError as e:
            logger.error("AI provider misconfigured provider=%s: %s", provider.name, e)
            raise
        _record(conn, user_id, provider, request, now, "ok", result)
        return result
    raise AssertionError("unreachable")


def error_body(e: Exception) -> tuple[int, dict[str, Any]]:
    """HTTP status and body for an AI failure (spec §7)."""
    if isinstance(e, AIDisabled):
        return 503, {"detail": "AI features are switched off", "code": "ai_disabled"}
    if isinstance(e, AILimit):
        return 429, {
            "detail": "AI limit reached for this month",
            "code": "ai_limit",
            "resets_on": e.resets_on.isoformat(),
        }
    if isinstance(e, AIConfigError):
        # The reason (bad key, unknown model) never contains the key itself.
        return 503, {
            "detail": f"AI isn't set up correctly on the server: {e}",
            "code": "ai_misconfigured",
        }
    if isinstance(e, AIUnavailable):
        reason = str(e)[:240]
        return 502, {
            "detail": f"AI is unavailable right now ({reason}). Try again in a minute."
            if reason
            else "AI is unavailable right now. Try again in a minute.",
            "code": "ai_unavailable",
        }
    if isinstance(e, AIRefused):
        return 422, {"detail": "This couldn't be analysed", "code": "ai_refused"}
    if isinstance(e, AIInvalidOutput):
        return 422, {
            "detail": "Couldn't read the AI's answer, try again",
            "code": "ai_invalid_output",
        }
    assert isinstance(e, AIError)
    return 502, {"detail": "AI request failed", "code": "ai_unavailable"}
