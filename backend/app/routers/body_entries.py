from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError

from app.auth import current_user_id
from app.clock import get_now
from app.crud import delete_row, insert_row, list_rows, require, update_row
from app.db import Conn, get_conn
from app.schemas import BodyEntryIn, BodyEntryOut, BodyEntryPatch, validate_not_future

router = APIRouter(prefix="/body-entries", tags=["body entries"])


def check_not_future(field: str, value: datetime | None, now: datetime) -> None:
    if value is None:
        return
    try:
        validate_not_future(value, now)
    except ValueError as exc:
        raise RequestValidationError(
            [{"type": "value_error", "loc": ("body", field), "msg": str(exc), "input": str(value)}]
        ) from exc


@router.get("", response_model=list[BodyEntryOut])
def list_entries(
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[dict[str, Any]]:
    return list_rows(conn, "body_entries", user_id, "measured_at", start, end)


@router.post("", response_model=BodyEntryOut, status_code=201)
def create_entry(
    body: BodyEntryIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    return insert_row(conn, "body_entries", user_id, body.model_dump())


@router.patch("/{entry_id}", response_model=BodyEntryOut)
def update_entry(
    entry_id: UUID,
    body: BodyEntryPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    data = body.model_dump(exclude_unset=True)
    return require(update_row(conn, "body_entries", user_id, entry_id, data))


@router.delete("/{entry_id}", status_code=204)
def delete_entry(
    entry_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    if not delete_row(conn, "body_entries", user_id, entry_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
