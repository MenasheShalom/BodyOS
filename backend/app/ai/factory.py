"""Builds the configured provider. Each vendor's SDK is imported only when it is chosen."""

from functools import lru_cache

from fastapi import Depends

from app.ai.provider import AIProvider
from app.config import Settings, get_settings


@lru_cache(maxsize=4)
def _build(
    provider: str,
    model: str | None,
    effort: str,
    timeout_s: float,
    anthropic_key: str | None,
    google_key: str | None,
) -> AIProvider:
    if provider == "anthropic":
        from app.ai.anthropic import AnthropicProvider

        return AnthropicProvider(anthropic_key, model, effort, timeout_s)
    if provider == "google":
        from app.ai.google import GoogleProvider

        return GoogleProvider(google_key, model, effort, timeout_s)
    from app.ai.fake import FakeProvider

    return FakeProvider(model or "fake-1")


def get_provider(settings: Settings = Depends(get_settings)) -> AIProvider | None:
    """None when AI is switched off. Raises AIConfigError when the chosen vendor is missing
    a key or (for Google) a model."""
    if settings.ai_provider == "none":
        return None
    return _build(
        settings.ai_provider,
        settings.ai_model,
        settings.ai_effort,
        settings.ai_timeout_s,
        settings.anthropic_api_key,
        settings.google_api_key,
    )
