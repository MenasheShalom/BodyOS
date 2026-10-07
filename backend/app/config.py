from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/bodyos_test"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str | None = None
    cors_origins: list[str] = ["http://localhost:5173"]
    photo_bucket: str = "progress-photos"
    usda_api_key: str = "DEMO_KEY"
    off_user_agent: str = "BodyOS/0.2 (personal nutrition tracker)"
    # "fake" serves built-in demo foods instead of calling OFF/USDA (end-to-end tests)
    food_sources: Literal["live", "fake"] = "live"
    # AI (sub-project 3). "none" switches every AI feature off.
    ai_provider: Literal["none", "anthropic", "google", "fake"] = "none"
    ai_model: str | None = None  # required for google; overrides the anthropic default
    ai_effort: Literal["low", "medium", "high"] = "medium"
    ai_monthly_request_limit: int = 300
    ai_timeout_s: float = 60
    anthropic_api_key: str | None = None
    google_api_key: str | None = None
    # MCP server (for Claude and other AI assistants). The public URLs are used in OAuth
    # metadata and redirects. Render sets RENDER_EXTERNAL_URL for the API service; the app URL
    # falls back to the first CORS origin, which is the frontend.
    public_api_url: str = Field(
        default="http://localhost:8000",
        validation_alias=AliasChoices("public_api_url", "render_external_url"),
    )
    app_url: str | None = None
    mcp_enabled: bool = True

    @property
    def frontend_url(self) -> str:
        return (self.app_url or self.cors_origins[0]).rstrip("/")

    @property
    def api_url(self) -> str:
        return self.public_api_url.rstrip("/")

    @field_validator("ai_provider", "ai_effort", mode="before")
    @classmethod
    def _lowercase(cls, value: object) -> object:
        # Dashboards make "Google" or " anthropic" easy to type; accept them.
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("ai_model", "anthropic_api_key", "google_api_key", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
