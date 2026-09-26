import uuid
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_token(token: str, settings: Settings) -> uuid.UUID:
    """Verify a Supabase access token. HS256 uses the project secret; RS256/ES256 use JWKS."""
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        key: Any
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise _unauthorized("Invalid or expired token")
            key, algorithms = settings.supabase_jwt_secret, ["HS256"]
        else:
            jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
            key = _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
            algorithms = ["RS256", "ES256"]
        claims = jwt.decode(token, key, algorithms=algorithms, audience="authenticated")
        return uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise _unauthorized("Invalid or expired token") from exc


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> uuid.UUID:
    if credentials is None:
        raise _unauthorized("Not authenticated")
    return decode_token(credentials.credentials, settings)
