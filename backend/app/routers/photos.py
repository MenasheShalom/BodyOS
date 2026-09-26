from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import current_user_id
from app.clock import get_now
from app.crud import delete_row, get_row, insert_row, list_rows, require
from app.db import Conn, get_conn
from app.routers.body_entries import check_not_future
from app.schemas import PhotoIn, PhotoOut, Pose, UploadUrlOut
from app.storage import PhotoStorage, get_storage, photo_path

router = APIRouter(prefix="/photos", tags=["photos"])


def _out(row: dict[str, Any], url: str) -> dict[str, Any]:
    return {**row, "url": url}


@router.post("/upload-url", response_model=UploadUrlOut)
def create_upload_url(
    user_id: UUID = Depends(current_user_id),
    storage: PhotoStorage = Depends(get_storage),
) -> UploadUrlOut:
    photo_id = uuid4()
    path = photo_path(user_id, photo_id)
    return UploadUrlOut(photo_id=photo_id, path=path, token=storage.create_upload(path))


@router.post("", response_model=PhotoOut, status_code=201)
def register_photo(
    body: PhotoIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    storage: PhotoStorage = Depends(get_storage),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("taken_at", body.taken_at, now)
    path = photo_path(user_id, body.photo_id)
    if not storage.exists(path):
        raise HTTPException(
            status_code=400, detail="Upload not found. Please try uploading the photo again."
        )
    data = {
        "id": body.photo_id,
        "taken_at": body.taken_at,
        "pose": body.pose,
        "note": body.note,
        "storage_path": path,
    }
    try:
        row = insert_row(conn, "progress_photos", user_id, data)
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="Photo already saved") from exc
    return _out(row, storage.signed_urls([path])[path])


@router.get("", response_model=list[PhotoOut])
def list_photos(
    pose: Pose | None = None,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    storage: PhotoStorage = Depends(get_storage),
) -> list[dict[str, Any]]:
    filters = {"pose": pose} if pose else None
    rows = list_rows(conn, "progress_photos", user_id, "taken_at", filters=filters)
    urls = storage.signed_urls([r["storage_path"] for r in rows])
    return [_out(r, urls.get(r["storage_path"], "")) for r in rows]


@router.delete("/{photo_id}", status_code=204)
def delete_photo(
    photo_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    storage: PhotoStorage = Depends(get_storage),
) -> Response:
    row = require(get_row(conn, "progress_photos", user_id, photo_id))
    storage.delete(row["storage_path"])  # object first: if this fails the row stays for a retry
    delete_row(conn, "progress_photos", user_id, photo_id)
    return Response(status_code=204)
