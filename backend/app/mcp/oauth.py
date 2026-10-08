"""OAuth 2.1 for the MCP server, built on the MCP SDK's authorization server.

The SDK serves the protocol (metadata, dynamic client registration, /authorize with PKCE,
/token, /revoke). This provider stores clients, codes and tokens in Postgres and sends the
user to the BodyOS consent page, where they sign in with their normal account and allow or
deny the client. Codes and tokens are random strings; only their SHA-256 hashes are stored.
"""

import hashlib
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar
from uuid import UUID

import anyio
import psycopg
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.config import Settings
from app.db import Conn

SCOPE = "bodyos"
REQUEST_TTL = timedelta(minutes=15)  # time to sign in and allow on the consent page
CODE_TTL = timedelta(minutes=5)
ACCESS_TTL = timedelta(hours=1)
REFRESH_TTL = timedelta(days=60)
MAX_CLIENTS = 500

T = TypeVar("T")


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def _now() -> datetime:
    return datetime.now(UTC)


class BodyOSOAuthProvider:
    """Implements the SDK's OAuthAuthorizationServerProvider against our tables."""

    def __init__(self, settings: Callable[[], Settings]) -> None:
        self._settings = settings

    @property
    def resource(self) -> str:
        return f"{self._settings().api_url}/mcp"

    async def _db(self, fn: Callable[[Conn], T]) -> T:
        def run() -> T:
            with psycopg.connect(
                self._settings().database_url, row_factory=dict_row, prepare_threshold=None
            ) as conn:
                return fn(conn)

        return await anyio.to_thread.run_sync(run)

    # --- clients ------------------------------------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        row = await self._db(
            lambda c: c.execute(
                "select info from oauth_clients where client_id = %s", (client_id,)
            ).fetchone()
        )
        return OAuthClientInformationFull.model_validate(row["info"]) if row else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        def insert(c: Conn) -> None:
            count = c.execute("select count(*) as n from oauth_clients").fetchone()
            assert count is not None
            if count["n"] >= MAX_CLIENTS:
                raise RegistrationError("invalid_client_metadata", "Too many registered clients")
            c.execute(
                "insert into oauth_clients (client_id, info) values (%s, %s)",
                (client_info.client_id, Jsonb(client_info.model_dump(mode="json"))),
            )

        await self._db(insert)

    # --- authorization ------------------------------------------------------------------------

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Parks the request and sends the user to the consent page."""
        if params.scopes and any(s != SCOPE for s in params.scopes):
            raise AuthorizeError("invalid_scope", f"The only scope is {SCOPE!r}")
        request_id = new_secret()

        def insert(c: Conn) -> None:
            c.execute("delete from oauth_requests where expires_at < now()")
            c.execute(
                "insert into oauth_requests (id, client_id, params, expires_at)"
                " values (%s, %s, %s, %s)",
                (
                    hash_secret(request_id),
                    client.client_id,
                    Jsonb(params.model_dump(mode="json")),
                    _now() + REQUEST_TTL,
                ),
            )

        await self._db(insert)
        return f"{self._settings().frontend_url}/connect?request={request_id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        row = await self._db(
            lambda c: c.execute(
                "select k.params, k.expires_at, g.client_id, g.user_id from oauth_codes k"
                " join oauth_grants g on g.id = k.grant_id"
                " where k.code_hash = %s and g.client_id = %s",
                (hash_secret(authorization_code), client.client_id),
            ).fetchone()
        )
        if row is None:
            return None
        params = AuthorizationParams.model_validate(row["params"])
        return AuthorizationCode(
            code=authorization_code,
            scopes=params.scopes or [SCOPE],
            expires_at=row["expires_at"].timestamp(),
            client_id=row["client_id"],
            code_challenge=params.code_challenge,
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=params.resource,
            subject=str(row["user_id"]),
        )

    def _issue(self, c: Conn, grant_id: UUID, scopes: list[str]) -> OAuthToken:
        access, refresh = new_secret(), new_secret()
        now = _now()
        for token, kind, ttl in ((access, "access", ACCESS_TTL), (refresh, "refresh", REFRESH_TTL)):
            c.execute(
                "insert into oauth_tokens (token_hash, grant_id, kind, expires_at)"
                " values (%s, %s, %s, %s)",
                (hash_secret(token), grant_id, kind, now + ttl),
            )
        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=int(ACCESS_TTL.total_seconds()),
            refresh_token=refresh,
            scope=" ".join(scopes),
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        def exchange(c: Conn) -> OAuthToken:
            # Codes are single use: deleting it is what claims it.
            row = c.execute(
                "delete from oauth_codes where code_hash = %s returning grant_id",
                (hash_secret(authorization_code.code),),
            ).fetchone()
            if row is None:
                raise TokenError("invalid_grant", "The code was already used")
            return self._issue(c, row["grant_id"], authorization_code.scopes)

        return await self._db(exchange)

    # --- tokens -------------------------------------------------------------------------------

    def _token_row(self, c: Conn, token: str, kind: str) -> dict[str, Any] | None:
        return c.execute(
            "select t.grant_id, t.expires_at, g.client_id, g.user_id, g.scopes from oauth_tokens t"
            " join oauth_grants g on g.id = t.grant_id"
            " where t.token_hash = %s and t.kind = %s and t.expires_at > now()",
            (hash_secret(token), kind),
        ).fetchone()

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        row = await self._db(lambda c: self._token_row(c, refresh_token, "refresh"))
        if row is None or row["client_id"] != client.client_id:
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=row["client_id"],
            scopes=list(row["scopes"]),
            expires_at=int(row["expires_at"].timestamp()),
            resource=self.resource,
            subject=str(row["user_id"]),
        )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        def rotate(c: Conn) -> OAuthToken:
            row = c.execute(
                "delete from oauth_tokens where token_hash = %s and kind = 'refresh'"
                " returning grant_id",
                (hash_secret(refresh_token.token),),
            ).fetchone()
            if row is None:
                raise TokenError("invalid_grant", "The refresh token was already used")
            # Old access tokens of this grant go with the old refresh token.
            c.execute(
                "delete from oauth_tokens where grant_id = %s and kind = 'access'",
                (row["grant_id"],),
            )
            return self._issue(c, row["grant_id"], scopes or refresh_token.scopes)

        return await self._db(rotate)

    async def load_access_token(self, token: str) -> AccessToken | None:
        def load(c: Conn) -> dict[str, Any] | None:
            row = self._token_row(c, token, "access")
            if row is not None:
                c.execute(
                    "update oauth_grants set last_used_at = now() where id = %s"
                    " and (last_used_at is null or last_used_at < now() - interval '5 minutes')",
                    (row["grant_id"],),
                )
            return row

        row = await self._db(load)
        if row is None:
            return None
        return AccessToken(
            token=token,
            client_id=row["client_id"],
            scopes=list(row["scopes"]),
            expires_at=int(row["expires_at"].timestamp()),
            resource=self.resource,
            subject=str(row["user_id"]),
        )

    async def exchange_identity_assertion(
        self, client: OAuthClientInformationFull, params: Any
    ) -> OAuthToken:
        raise TokenError("unsupported_grant_type", "Identity assertions aren't supported")

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        """Revoking either token ends the whole grant, as RFC 7009 allows."""
        await self._db(
            lambda c: c.execute(
                "delete from oauth_grants where id ="
                " (select grant_id from oauth_tokens where token_hash = %s)",
                (hash_secret(token.token),),
            )
        )


# --- the consent page's side (called from the normal, Supabase-authenticated API) ---------------


def pending_request(conn: Conn, request_id: str) -> dict[str, Any] | None:
    return conn.execute(
        "select r.client_id, r.params, c.info from oauth_requests r"
        " join oauth_clients c on c.client_id = r.client_id"
        " where r.id = %s and r.expires_at > now()",
        (hash_secret(request_id),),
    ).fetchone()


def approve(conn: Conn, request_id: str, user_id: UUID, resource: str) -> str | None:
    """Turns the pending request into a grant and a code; returns the client redirect URL."""
    row = conn.execute(
        "delete from oauth_requests where id = %s and expires_at > now()"
        " returning client_id, params",
        (hash_secret(request_id),),
    ).fetchone()
    if row is None:
        return None
    params = AuthorizationParams.model_validate(row["params"])
    grant = conn.execute(
        "insert into oauth_grants (client_id, user_id, scopes, resource)"
        " values (%s, %s, %s, %s) returning id",
        (row["client_id"], user_id, params.scopes or [SCOPE], resource),
    ).fetchone()
    assert grant is not None
    code = new_secret()
    conn.execute(
        "insert into oauth_codes (code_hash, grant_id, params, expires_at) values (%s, %s, %s, %s)",
        (hash_secret(code), grant["id"], Jsonb(row["params"]), _now() + CODE_TTL),
    )
    return construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state)


def deny(conn: Conn, request_id: str) -> str | None:
    row = conn.execute(
        "delete from oauth_requests where id = %s returning params", (hash_secret(request_id),)
    ).fetchone()
    if row is None:
        return None
    params = AuthorizationParams.model_validate(row["params"])
    return construct_redirect_uri(
        str(params.redirect_uri), error="access_denied", state=params.state
    )
