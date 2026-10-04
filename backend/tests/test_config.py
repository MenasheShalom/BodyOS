import pytest

from app.config import Settings


@pytest.mark.parametrize("value", ["Google", " GOOGLE ", "google"])
def test_ai_provider_is_case_insensitive(monkeypatch, value: str) -> None:
    monkeypatch.setenv("AI_PROVIDER", value)
    monkeypatch.setenv("AI_EFFORT", "High")
    settings = Settings()
    assert (settings.ai_provider, settings.ai_effort) == ("google", "high")


def test_blank_model_and_keys_count_as_unset(monkeypatch) -> None:
    monkeypatch.setenv("AI_MODEL", "  ")
    monkeypatch.setenv("GOOGLE_API_KEY", "")
    settings = Settings()
    assert settings.ai_model is None and settings.google_api_key is None


def test_unknown_provider_still_rejected(monkeypatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "openai")
    with pytest.raises(ValueError):
        Settings()
