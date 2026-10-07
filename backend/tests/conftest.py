import os
import pathlib
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any

import jwt
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.clock import get_now
from app.config import Settings, get_settings
from app.main import create_app
from app.storage import get_storage

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SHIM = pathlib.Path(__file__).parent / "sql" / "supabase_shim.sql"
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bodyos_test"
)
TABLES = [
    "achievements",
    "ai_reports",
    "ai_body_fat_estimates",
    "ai_usage",
    "ai_settings",
    "nutrition_day_flags",
    "target_suggestion_dismissals",
    "saved_meal_items",
    "saved_meals",
    "recipe_items",
    "food_favourites",
    "food_log",
    "nutrition_targets",
    "nutrition_settings",
    "foods",
    "recipes",
    "goals",
    "progress_photos",
    "measurements",
    "body_entries",
    "profiles",
]


@pytest.fixture(scope="session")
def migrated_db() -> str:
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "drop schema if exists public cascade;"
            " drop schema if exists auth cascade;"
            " drop schema if exists storage cascade;"
            " create schema public;"
        )
        conn.execute(SHIM.read_text())
        for migration in MIGRATIONS:
            conn.execute(migration.read_text())
    return TEST_DB_URL


@pytest.fixture
def db(migrated_db: str) -> Iterator[str]:
    with psycopg.connect(migrated_db, autocommit=True) as conn:
        tables = ", ".join(f"public.{t}" for t in TABLES)
        conn.execute(f"truncate {tables}, auth.users cascade")
    yield migrated_db


@pytest.fixture
def make_user(db: str) -> Callable[[], uuid.UUID]:
    def _make() -> uuid.UUID:
        user_id = uuid.uuid4()
        with psycopg.connect(db, autocommit=True) as conn:
            conn.execute("insert into auth.users (id) values (%s)", (user_id,))
        return user_id

    return _make


JWT_SECRET = "test-secret-with-at-least-32-characters!!"
FIXED_NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)


def make_token(user_id: uuid.UUID, *, expires_in: int = 3600, secret: str = JWT_SECRET) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "aud": "authenticated",
        "role": "authenticated",
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


def auth_for(user_id: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


@pytest.fixture
def app_under_test(db: str) -> Any:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url=db, supabase_jwt_secret=JWT_SECRET
    )
    app.dependency_overrides[get_now] = lambda: FIXED_NOW
    return app


@pytest.fixture
def client(app_under_test: Any) -> Iterator[TestClient]:
    with TestClient(app_under_test) as c:
        yield c


@pytest.fixture
def user(make_user: Callable[[], uuid.UUID]) -> uuid.UUID:
    return make_user()


@pytest.fixture
def headers(user: uuid.UUID) -> dict[str, str]:
    return auth_for(user)


class FakeStorage:
    def __init__(self) -> None:
        self.objects: set[str] = set()
        self.deleted: list[str] = []

    def create_upload(self, path: str) -> str:
        return f"token-for-{path}"

    def signed_urls(self, paths: list[str], expires_in: int = 3600) -> dict[str, str]:
        return {p: f"https://storage.test/{p}?sig=1" for p in paths}

    def exists(self, path: str) -> bool:
        return path in self.objects

    def delete(self, path: str) -> None:
        self.objects.discard(path)
        self.deleted.append(path)

    def download(self, path: str) -> bytes:
        if path not in self.objects:
            raise FileNotFoundError(path)
        return b"\xff\xd8\xff\xe0" + path.encode()  # JPEG magic bytes


@pytest.fixture
def storage(app_under_test: Any) -> FakeStorage:
    fake = FakeStorage()
    app_under_test.dependency_overrides[get_storage] = lambda: fake
    return fake


AI_LIMIT = 3


@pytest.fixture
def ai(app_under_test: Any, db: str) -> None:
    """Runs the app with the fake AI provider and a small monthly limit."""
    from app.ai.factory import _build

    _build.cache_clear()
    app_under_test.dependency_overrides[get_settings] = lambda: Settings(
        database_url=db,
        supabase_jwt_secret=JWT_SECRET,
        ai_provider="fake",
        ai_monthly_request_limit=AI_LIMIT,
    )
