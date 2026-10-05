import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.provider import AIError
from app.ai.service import AIDisabled, AILimit, error_body
from app.config import get_settings
from app.routers import (
    ai,
    ai_insight,
    body_entries,
    dashboard,
    favourites,
    food_log,
    foods,
    goals,
    measurements,
    nutrition,
    photos,
    profile,
    recipes,
    saved_meals,
    series,
)

logger = logging.getLogger("bodyos")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="BodyOS API")

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

    return app


app = create_app()
