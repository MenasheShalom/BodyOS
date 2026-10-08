import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import parse_qs, urlparse

import psycopg
import pytest

from app.food_sources import get_food_sources
from app.food_sources.fake import default_sources
from tests.conftest import auth_for

CALLBACK = "https://claude.ai/api/mcp/auth_callback"
RESOURCE = "http://localhost:8000/mcp"
PROFILE = {
    "height_cm": 168,
    "sex": "male",
    "date_of_birth": "1988-01-01",
    "timezone": "Asia/Jerusalem",
}
MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
}


def register(client) -> str:
    res = client.post(
        "/register",
        json={
            "redirect_uris": [CALLBACK],
            "client_name": "Claude",
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["client_id"])


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def start(client, client_id: str, challenge: str) -> str:
    res = client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": CALLBACK,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": "st-1",
            "scope": "bodyos",
            "resource": RESOURCE,
        },
        follow_redirects=False,
    )
    assert res.status_code == 302, res.text
    location = res.headers["location"]
    assert location.startswith("http://localhost:5173/connect?request=")
    return parse_qs(urlparse(location).query)["request"][0]


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def connect(client, headers) -> dict[str, Any]:
    """The whole dance: register, authorize, consent, token."""
    client_id = register(client)
    verifier, challenge = pkce()
    request_id = start(client, client_id, challenge)
    approved = client.post(f"/oauth/requests/{request_id}/approve", headers=headers).json()
    params = query(approved["redirect_url"])
    assert params["state"] == "st-1"
    res = client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": params["code"],
            "redirect_uri": CALLBACK,
            "client_id": client_id,
            "code_verifier": verifier,
            "resource": RESOURCE,
        },
    )
    assert res.status_code == 200, res.text
    return {**res.json(), "client_id": client_id, "code": params["code"], "verifier": verifier}


def rpc(client, token: str, method: str, params: dict[str, Any] | None = None) -> Any:
    res = client.post(
        "/mcp",
        headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
    )
    return res


def call(client, token: str, tool: str, **arguments: Any) -> Any:
    res = rpc(client, token, "tools/call", {"name": tool, "arguments": arguments})
    assert res.status_code == 200, res.text
    return res.json()["result"]


@pytest.fixture
def sources(app_under_test):
    fakes = default_sources()
    app_under_test.dependency_overrides[get_food_sources] = lambda: fakes
    return fakes


def test_metadata(client) -> None:
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["issuer"] == "http://localhost:8000"
    assert meta["registration_endpoint"].endswith("/register")
    assert meta["code_challenge_methods_supported"] == ["S256"]
    resource = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert resource["resource"] == RESOURCE and resource["authorization_servers"] == [
        "http://localhost:8000"
    ]
    res = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert res.status_code == 401
    assert "resource_metadata=" in res.headers["www-authenticate"]


def test_connect_and_use_tools(client, headers, user, db, sources) -> None:
    assert client.put("/me/profile", json=PROFILE, headers=headers).status_code == 200
    tokens = connect(client, headers)
    assert tokens["token_type"] == "Bearer" and tokens["refresh_token"]
    token = tokens["access_token"]
    with psycopg.connect(db) as conn:
        stored = conn.execute("select token_hash from oauth_tokens").fetchall()
    assert token not in {r[0] for r in stored}  # only hashes are kept

    init = rpc(
        client,
        token,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "t", "version": "1"},
        },
    )
    assert init.status_code == 200, init.text
    assert init.json()["result"]["serverInfo"]["name"] == "bodyos"
    names = {t["name"] for t in rpc(client, token, "tools/list").json()["result"]["tools"]}
    assert {"get_summary", "log_weigh_in", "search_foods", "log_food", "quick_add"} <= names

    weigh = call(client, token, "log_weigh_in", weight_kg=74.2, body_fat_pct=21.5)
    assert weigh["structuredContent"]["weight_kg"] == 74.2
    past = call(client, token, "log_weigh_in", weight_kg=74.8, day="2026-02-27")
    # 07:00 in Jerusalem
    assert past["structuredContent"]["measured_at"] == "2026-02-27T05:00:00+00:00"

    found_res = call(client, token, "search_foods", query="hummus")
    assert not found_res["isError"], found_res
    found = found_res["structuredContent"]
    hummus = found["external"][0]
    assert hummus["name"] == "Demo hummus" and hummus["id"] is None
    logged = call(
        client,
        token,
        "log_food",
        grams=60,
        meal="lunch",
        source=hummus["source"],
        source_ref=hummus["source_ref"],
    )["structuredContent"]
    assert logged["name"] == "Demo hummus" and logged["nutrients"]["energy_kcal"] == 162
    call(client, token, "quick_add", name="Falafel", energy_kcal=350, protein_g=12, meal="dinner")
    day = call(client, token, "get_food_day")["structuredContent"]
    assert [e["name"] for e in day["entries"]] == ["Demo hummus", "Falafel"]
    assert day["totals"]["energy_kcal"] == 512

    gone = call(client, token, "delete_food_entry", entry_id=logged["id"])
    assert gone["isError"] is False
    assert len(call(client, token, "get_food_day")["structuredContent"]["entries"]) == 1

    summary = call(client, token, "get_summary")["structuredContent"]
    assert "hero" in summary and "goals" in summary
    trend = call(client, token, "get_trend", metric="weight_kg", range="1M")["structuredContent"]
    assert trend["latest"] is not None and "points" not in trend
    trophies = call(client, token, "get_trophies")["structuredContent"]["result"]
    assert any(t["key"] == "first_weigh_in" and t["earned_on"] for t in trophies)

    # errors come back as tool errors, not crashes
    bad = call(client, token, "get_trend", metric="iq")
    assert bad["isError"] is True and "Unknown metric" in bad["content"][0]["text"]
    future = call(client, token, "log_weigh_in", weight_kg=70, day="2030-01-01")
    assert future["isError"] is True
    nothing = call(client, token, "log_food", grams=10, meal="snack")
    assert nothing["isError"] is True

    # the data really is the user's
    with psycopg.connect(db) as conn:
        assert conn.execute(
            "select count(*) from body_entries where user_id = %s", (user,)
        ).fetchone() == (2,)


def test_codes_are_single_use_and_need_pkce(client, headers) -> None:
    tokens = connect(client, headers)
    again = client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": tokens["code"],
            "redirect_uri": CALLBACK,
            "client_id": tokens["client_id"],
            "code_verifier": tokens["verifier"],
        },
    )
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"

    client_id = register(client)
    _, challenge = pkce()
    request_id = start(client, client_id, challenge)
    code = query(
        client.post(f"/oauth/requests/{request_id}/approve", headers=headers).json()["redirect_url"]
    )["code"]
    wrong = client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": CALLBACK,
            "client_id": client_id,
            "code_verifier": "x" * 50,
        },
    )
    assert wrong.status_code == 400


def test_refresh_rotates(client, headers) -> None:
    tokens = connect(client, headers)
    refresh = lambda rt: client.post(  # noqa: E731
        "/token",
        data={"grant_type": "refresh_token", "refresh_token": rt, "client_id": tokens["client_id"]},
    )
    res = refresh(tokens["refresh_token"])
    assert res.status_code == 200, res.text
    new = res.json()
    assert new["access_token"] != tokens["access_token"]
    # the old pair stops working
    assert refresh(tokens["refresh_token"]).status_code == 400
    assert rpc(client, tokens["access_token"], "tools/list").status_code == 401
    assert rpc(client, new["access_token"], "tools/list").status_code == 200


def test_deny_and_expired_requests(client, headers) -> None:
    client_id = register(client)
    _, challenge = pkce()
    request_id = start(client, client_id, challenge)
    consent = client.get(f"/oauth/requests/{request_id}", headers=headers).json()
    assert consent == {"client_name": "Claude", "client_uri": None, "redirect_host": "claude.ai"}
    denied = client.post(f"/oauth/requests/{request_id}/deny", headers=headers).json()
    assert query(denied["redirect_url"]) == {"error": "access_denied", "state": "st-1"}
    # used up
    assert client.get(f"/oauth/requests/{request_id}", headers=headers).status_code == 404
    assert client.post(f"/oauth/requests/{request_id}/approve", headers=headers).status_code == 404
    # consent needs a signed-in user
    request_id = start(client, client_id, challenge)
    assert client.post(f"/oauth/requests/{request_id}/approve").status_code == 401


def test_connected_apps_can_be_revoked(client, headers, make_user) -> None:
    tokens = connect(client, headers)
    grants = client.get("/oauth/grants", headers=headers).json()
    assert [g["client_name"] for g in grants] == ["Claude"]
    other = auth_for(make_user())
    assert client.get("/oauth/grants", headers=other).json() == []
    assert client.delete(f"/oauth/grants/{grants[0]['id']}", headers=other).status_code == 404
    assert client.delete(f"/oauth/grants/{grants[0]['id']}", headers=headers).status_code == 204
    assert rpc(client, tokens["access_token"], "tools/list").status_code == 401
    assert client.get("/oauth/grants", headers=headers).json() == []


def test_revoke_endpoint(client, headers) -> None:
    tokens = connect(client, headers)
    # The SDK's revocation form insists on a client_secret field even for public clients.
    res = client.post(
        "/revoke",
        data={
            "token": tokens["refresh_token"],
            "client_id": tokens["client_id"],
            "client_secret": "",
        },
    )
    assert res.status_code == 200, res.text
    assert rpc(client, tokens["access_token"], "tools/list").status_code == 401


def test_tokens_only_see_their_user(client, headers, make_user, user) -> None:
    other_headers = auth_for(make_user())
    client.put("/me/profile", json=PROFILE, headers=headers)
    client.put("/me/profile", json=PROFILE, headers=other_headers)
    mine = connect(client, headers)["access_token"]
    theirs = connect(client, other_headers)["access_token"]
    call(client, mine, "quick_add", name="Mine", energy_kcal=100, meal="snack")
    assert call(client, theirs, "get_food_day")["structuredContent"]["entries"] == []
    assert len(call(client, mine, "get_food_day")["structuredContent"]["entries"]) == 1
