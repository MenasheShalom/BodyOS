from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/bodyos_test"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str | None = None
    cors_origins: list[str] = ["http://localhost:5173"]
    photo_bucket: str = "progress-photos"


@lru_cache
def get_settings() -> Settings:
    return Settings()
