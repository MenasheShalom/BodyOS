from collections.abc import Iterator
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.db import get_conn


def test_writes_commit_before_the_response_starts(app_under_test: Any, client, headers, db) -> None:
    """Clients refetch immediately after a save, so the commit must land before the response."""
    events: list[str] = []

    def tracking_conn() -> Iterator[Any]:
        with psycopg.connect(db, row_factory=dict_row) as conn:
            yield conn
        events.append("committed")

    app_under_test.dependency_overrides[get_conn] = tracking_conn
    inner = app_under_test.middleware_stack or app_under_test.build_middleware_stack()

    async def spy(scope: Any, receive: Any, send: Any) -> None:
        async def wrapped_send(message: Any) -> None:
            if message["type"] == "http.response.start":
                events.append("response-start")
            await send(message)

        await inner(scope, receive, wrapped_send)

    app_under_test.middleware_stack = spy
    res = client.post(
        "/body-entries",
        json={"measured_at": "2026-02-28T07:00:00Z", "weight_kg": 80},
        headers=headers,
    )
    assert res.status_code == 201
    assert events == ["committed", "response-start"]
