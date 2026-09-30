from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from psycopg import sql

from app.db import Conn

Table = Literal[
    "body_entries",
    "measurements",
    "progress_photos",
    "goals",
    "foods",
    "food_log",
    "nutrition_targets",
    "recipes",
    "saved_meals",
]


def require(row: dict[str, Any] | None) -> dict[str, Any]:
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


def insert_row(conn: Conn, table: Table, user_id: UUID, data: Mapping[str, Any]) -> dict[str, Any]:
    cols = ["user_id", *data.keys()]
    query = sql.SQL("insert into {} ({}) values ({}) returning *").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(c) for c in cols),
        sql.SQL(", ").join([sql.Placeholder()] * len(cols)),
    )
    row = conn.execute(query, [user_id, *data.values()]).fetchone()
    assert row is not None
    return row


def list_rows(
    conn: Conn,
    table: Table,
    user_id: UUID,
    time_col: str,
    start: datetime | None = None,
    end: datetime | None = None,
    filters: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    clauses: list[sql.Composable] = [sql.SQL("user_id = %s")]
    params: list[Any] = [user_id]
    if start is not None:
        clauses.append(sql.SQL("{} >= %s").format(sql.Identifier(time_col)))
        params.append(start)
    if end is not None:
        clauses.append(sql.SQL("{} <= %s").format(sql.Identifier(time_col)))
        params.append(end)
    for col, value in (filters or {}).items():
        clauses.append(sql.SQL("{} = %s").format(sql.Identifier(col)))
        params.append(value)
    query = sql.SQL("select * from {} where {} order by {} desc").format(
        sql.Identifier(table), sql.SQL(" and ").join(clauses), sql.Identifier(time_col)
    )
    return conn.execute(query, params).fetchall()


def get_row(conn: Conn, table: Table, user_id: UUID, row_id: UUID) -> dict[str, Any] | None:
    query = sql.SQL("select * from {} where id = %s and user_id = %s").format(sql.Identifier(table))
    return conn.execute(query, (row_id, user_id)).fetchone()


def update_row(
    conn: Conn, table: Table, user_id: UUID, row_id: UUID, data: Mapping[str, Any]
) -> dict[str, Any] | None:
    if not data:
        return get_row(conn, table, user_id, row_id)
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = %s").format(sql.Identifier(c)) for c in data.keys()
    )
    query = sql.SQL("update {} set {} where id = %s and user_id = %s returning *").format(
        sql.Identifier(table), assignments
    )
    return conn.execute(query, [*data.values(), row_id, user_id]).fetchone()


def delete_row(conn: Conn, table: Table, user_id: UUID, row_id: UUID) -> bool:
    query = sql.SQL("delete from {} where id = %s and user_id = %s returning id").format(
        sql.Identifier(table)
    )
    return conn.execute(query, (row_id, user_id)).fetchone() is not None
