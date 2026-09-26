from collections.abc import Iterator
from typing import Any

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.config import Settings, get_settings

Conn = psycopg.Connection[dict[str, Any]]


# Routes depend on this with scope="function" so the commit happens before the response
# is sent; clients refetch derived data immediately after a write.
def get_conn(settings: Settings = Depends(get_settings)) -> Iterator[Conn]:
    # prepare_threshold=None keeps us compatible with Supabase's pooler.
    with psycopg.connect(
        settings.database_url, row_factory=dict_row, prepare_threshold=None
    ) as conn:
        yield conn
