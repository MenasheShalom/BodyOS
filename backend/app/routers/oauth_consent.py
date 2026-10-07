"""The app's side of connecting an AI assistant: the consent page and connected apps."""

from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.auth import current_user_id
from app.config import Settings, get_settings
from app.db import Conn, get_conn
from app.mcp.oauth import approve, deny, pending_request

router = APIRouter(prefix="/oauth", tags=["oauth"])

EXPIRED = "This request has expired. Start connecting again from your assistant."


class ConsentOut(BaseModel):
    client_name: str
    client_uri: str | None
    redirect_host: str  # where the user is sent back to; shown so they can judge the request


class RedirectOut(BaseModel):
    redirect_url: str


class GrantOut(BaseModel):
    id: UUID
    client_name: str
    created_at: datetime
    last_used_at: datetime | None


def _name(info: dict[str, Any]) -> str:
    return str(info.get("client_name") or info.get("client_id") or "An app")[:100]


@router.get("/requests/{request_id}", response_model=ConsentOut)
def get_request(
    request_id: str,
    _user: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> ConsentOut:
    row = pending_request(conn, request_id)
    if row is None:
        raise HTTPException(status_code=404, detail=EXPIRED)
    return ConsentOut(
        client_name=_name(row["info"]),
        client_uri=row["info"].get("client_uri"),
        redirect_host=urlparse(row["params"]["redirect_uri"]).netloc,
    )


@router.post("/requests/{request_id}/approve", response_model=RedirectOut)
def approve_request(
    request_id: str,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    settings: Settings = Depends(get_settings),
) -> RedirectOut:
    url = approve(conn, request_id, user_id, f"{settings.api_url}/mcp")
    if url is None:
        raise HTTPException(status_code=404, detail=EXPIRED)
    return RedirectOut(redirect_url=url)


@router.post("/requests/{request_id}/deny", response_model=RedirectOut)
def deny_request(
    request_id: str,
    _user: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> RedirectOut:
    url = deny(conn, request_id)
    if url is None:
        raise HTTPException(status_code=404, detail=EXPIRED)
    return RedirectOut(redirect_url=url)


@router.get("/grants", response_model=list[GrantOut])
def list_grants(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[GrantOut]:
    rows = conn.execute(
        "select g.id, c.info, g.created_at, g.last_used_at from oauth_grants g"
        " join oauth_clients c on c.client_id = g.client_id"
        " where g.user_id = %s and exists (select 1 from oauth_tokens t where t.grant_id = g.id"
        "   and t.expires_at > now())"
        " order by coalesce(g.last_used_at, g.created_at) desc",
        (user_id,),
    ).fetchall()
    return [
        GrantOut(
            id=r["id"],
            client_name=_name(r["info"]),
            created_at=r["created_at"],
            last_used_at=r["last_used_at"],
        )
        for r in rows
    ]


@router.delete("/grants/{grant_id}", status_code=204)
def revoke_grant(
    grant_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    deleted = conn.execute(
        "delete from oauth_grants where id = %s and user_id = %s", (grant_id, user_id)
    ).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
