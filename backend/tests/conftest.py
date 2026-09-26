import os
import pathlib
import uuid
from collections.abc import Callable, Iterator

import psycopg
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SHIM = pathlib.Path(__file__).parent / "sql" / "supabase_shim.sql"
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bodyos_test"
)
TABLES = ["goals", "progress_photos", "measurements", "body_entries", "profiles"]


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
