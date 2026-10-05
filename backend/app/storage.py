from typing import Any, Protocol
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import httpx
from fastapi import Depends

from app.config import Settings, get_settings


class PhotoStorage(Protocol):
    def create_upload(self, path: str) -> str: ...
    def signed_urls(self, paths: list[str], expires_in: int = 3600) -> dict[str, str]: ...
    def exists(self, path: str) -> bool: ...
    def delete(self, path: str) -> None: ...
    def download(self, path: str) -> bytes: ...


def photo_path(user_id: UUID, photo_id: UUID) -> str:
    return f"{user_id}/{photo_id}.jpg"


class SupabaseStorage:
    """Minimal client for Supabase Storage's REST API using the service role key."""

    def __init__(self, base_url: str, service_key: str, bucket: str) -> None:
        self._base = f"{base_url.rstrip('/')}/storage/v1"
        self._bucket = bucket
        self._client = httpx.Client(
            base_url=self._base,
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=10,
        )

    def create_upload(self, path: str) -> str:
        res = self._client.post(f"/object/upload/sign/{self._bucket}/{path}")
        res.raise_for_status()
        url: str = res.json()["url"]
        return parse_qs(urlparse(url).query)["token"][0]

    def signed_urls(self, paths: list[str], expires_in: int = 3600) -> dict[str, str]:
        if not paths:
            return {}
        res = self._client.post(
            f"/object/sign/{self._bucket}", json={"expiresIn": expires_in, "paths": paths}
        )
        res.raise_for_status()
        items: list[dict[str, Any]] = res.json()
        return {i["path"]: f"{self._base}{i['signedURL']}" for i in items if i.get("signedURL")}

    def exists(self, path: str) -> bool:
        folder, name = path.rsplit("/", 1)
        res = self._client.post(
            f"/object/list/{self._bucket}",
            json={"prefix": folder, "search": name, "limit": 1, "offset": 0},
        )
        res.raise_for_status()
        return any(obj.get("name") == name for obj in res.json())

    def delete(self, path: str) -> None:
        res = self._client.request("DELETE", f"/object/{self._bucket}", json={"prefixes": [path]})
        res.raise_for_status()

    def download(self, path: str) -> bytes:
        res = self._client.get(f"/object/authenticated/{self._bucket}/{path}")
        res.raise_for_status()
        return res.content


def get_storage(settings: Settings = Depends(get_settings)) -> PhotoStorage:
    return SupabaseStorage(
        settings.supabase_url, settings.supabase_service_role_key, settings.photo_bucket
    )
