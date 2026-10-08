import inspect
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.routing import Route

from app.ai.provider import AIError
from app.ai.service import AIDisabled, AILimit, error_body
from app.clock import get_now
from app.config import get_settings
from app.food_sources import get_food_sources
from app.mcp.server import Deps, build_mcp, mcp_transport_security
from app.routers import (
    achievements,
    ai,
    ai_insight,
    ai_planning,
    body_entries,
    dashboard,
    favourites,
    food_log,
    foods,
    goals,
    measurements,
    nutrition,
    oauth_consent,
    photos,
    profile,
    recipes,
    saved_meals,
    series,
    training,
)

logger = logging.getLogger("bodyos")


def _call_with_settings(dep: Callable[..., Any], settings: Any) -> Any:
    """Calls a settings-taking dependency, or an override of it that takes nothing."""
    return dep(settings) if inspect.signature(dep).parameters else dep()


def create_app() -> FastAPI:
    settings = get_settings()
    mcp_app = None
    if settings.mcp_enabled:
        # The tools look settings, the clock and food sources up through the app's dependency
        # overrides, so tests can swap them like they do for routes.
        def override(dep: Callable[..., Any]) -> Callable[..., Any]:
            return app.dependency_overrides.get(dep, dep)

        deps = Deps(
            settings=lambda: override(get_settings)(),
            now=lambda: override(get_now)(),
            sources=lambda s: _call_with_settings(override(get_food_sources), s),
        )
        mcp = build_mcp(deps, settings)
        mcp_app = mcp.streamable_http_app(
            streamable_http_path="/mcp",
            stateless_http=True,
            json_response=True,
            transport_security=mcp_transport_security(),
        )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if mcp_app is None:
            yield
            return
        async with mcp.session_manager.run():
            yield

    app = FastAPI(title="BodyOS API", lifespan=lifespan)

    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled error request_id=%s path=%s", request_id, request.url.path)
            response = JSONResponse(
                status_code=500,
                content={"detail": "Something went wrong", "request_id": request_id},
            )
        response.headers["X-Request-ID"] = request_id
        return response

    # CORS is added last so it wraps everything, including error responses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.exception_handler(AIError)
    @app.exception_handler(AIDisabled)
    @app.exception_handler(AILimit)
    async def ai_error_handler(request: Request, exc: Exception) -> JSONResponse:
        status_code, body = error_body(exc)
        return JSONResponse(status_code=status_code, content=body)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(profile.router)
    app.include_router(body_entries.router)
    app.include_router(measurements.router)
    app.include_router(series.router)
    app.include_router(goals.router)
    app.include_router(photos.router)
    app.include_router(dashboard.router)
    app.include_router(foods.router)
    app.include_router(food_log.router)
    app.include_router(nutrition.router)
    app.include_router(favourites.router)
    app.include_router(recipes.router)
    app.include_router(saved_meals.router)
    app.include_router(ai.router)
    app.include_router(ai_insight.router)
    app.include_router(ai_planning.router)
    app.include_router(achievements.router)
    app.include_router(training.router)
    app.include_router(oauth_consent.router)

    # The MCP server and its OAuth endpoints (/mcp, /authorize, /token, /register, /revoke and
    # the /.well-known metadata). Each path is routed to the MCP app whole, so its auth
    # middleware applies and nothing else in the API is shadowed.
    if mcp_app is not None:
        for route in mcp_app.routes:
            assert isinstance(route, Route)
            app.router.routes.append(Route(route.path, endpoint=mcp_app))
    return app


app = create_app()
