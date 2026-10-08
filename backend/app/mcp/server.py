"""The BodyOS MCP server: tools for an AI assistant to read and log the user's data.

Each tool runs as the user who connected the assistant (the OAuth token's subject) and reuses
the API's own endpoint functions, so it validates and behaves exactly like the app.
"""

from collections.abc import Callable
from datetime import date, datetime, time
from typing import Any, Literal, TypeVar
from uuid import UUID

import anyio
import psycopg
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from psycopg.rows import dict_row
from pydantic import ValidationError

from app.config import Settings
from app.db import Conn
from app.food_sources import FoodSource
from app.mcp.oauth import SCOPE, BodyOSOAuthProvider
from app.metrics import METRICS
from app.nutrition_schemas import CustomFoodIn, FoodLogIn, ImportIn, QuickAddIn, ServingIn
from app.profiles import load_profile
from app.routers import achievements, dashboard, food_log, foods, nutrition, series
from app.routers.body_entries import create_entry
from app.schemas import BodyEntryIn
from app.services.series_service import UTC_ZONE, local_today

Meal = Literal["breakfast", "lunch", "dinner", "snack"]
MEAL_HOUR = {"breakfast": 8, "lunch": 13, "dinner": 19, "snack": 16}
READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
MAX_TREND_POINTS = 40

INSTRUCTIONS = """BodyOS is the user's personal body-recomposition tracker: weigh-ins and body
composition, tape measurements, food log with calorie and macro targets, goals, trophies and
weekly reports. All numbers are the user's own data. Trends are smoothed (EWMA) and are what
the app uses for decisions; single weigh-ins are noisy. To log food from a description, search
for each food first and log it by id with grams; use quick_add only when nothing suitable is
found. When a food the user eats often isn't in any database (a local product, a home
recipe, a label they read out), save it with create_food so it can be logged by id from then
on. Dates are the user's local dates (YYYY-MM-DD)."""

T = TypeVar("T")


class Deps:
    """What the tools need from the app, looked up per call so tests can override them."""

    def __init__(
        self,
        settings: Callable[[], Settings],
        now: Callable[[], datetime],
        sources: Callable[[Settings], dict[str, FoodSource]],
    ) -> None:
        self.settings = settings
        self.now = now
        self.sources = sources


def _user_id() -> UUID:
    token = get_access_token()
    if token is None or token.subject is None:
        raise ToolError("Not signed in")
    return UUID(token.subject)


def _json(value: Any) -> dict[str, Any]:
    out: dict[str, Any] = jsonable_encoder(value)
    return out


def build_mcp(deps: Deps, settings: Settings) -> MCPServer:
    provider = BodyOSOAuthProvider(deps.settings)
    server = MCPServer(
        name="bodyos",
        title="BodyOS",
        instructions=INSTRUCTIONS,
        auth_server_provider=provider,
        auth=AuthSettings(
            issuer_url=settings.api_url,
            resource_server_url=f"{settings.api_url}/mcp",
            validate_token_resource=True,
            required_scopes=[SCOPE],
            client_registration_options=ClientRegistrationOptions(
                enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
            ),
            revocation_options=RevocationOptions(enabled=True),
        ),
    )

    async def run(fn: Callable[[Conn, UUID], T]) -> T:
        """Runs `fn(conn, user_id)` in a worker thread with its own committed connection."""
        user_id = _user_id()

        def work() -> T:
            with psycopg.connect(
                deps.settings().database_url, row_factory=dict_row, prepare_threshold=None
            ) as conn:
                try:
                    return fn(conn, user_id)
                except HTTPException as exc:
                    raise ToolError(str(exc.detail)) from exc
                except ValidationError as exc:
                    raise ToolError(exc.errors()[0]["msg"]) from exc

        return await anyio.to_thread.run_sync(work)

    def eaten_at(conn: Conn, user_id: UUID, day: date | None, meal: str) -> datetime:
        """Now when logging today; otherwise the meal's usual time on that day, locally."""
        profile = load_profile(conn, user_id)
        tz = profile.tz if profile else UTC_ZONE
        now = deps.now()
        if day is None or day == now.astimezone(tz).date():
            return now
        return datetime.combine(day, time(MEAL_HOUR[meal]), tz)

    # --- reading ------------------------------------------------------------------------------

    @server.tool(annotations=READ)
    async def get_summary() -> dict[str, Any]:
        """Dashboard overview: latest trend values (weight, body fat, fat and lean mass…) with
        recent change, goals with projections, today's food against targets, and reminders."""
        return _json(
            await run(lambda c, u: dashboard.get_dashboard(user_id=u, conn=c, now=deps.now()))
        )

    @server.tool(annotations=READ)
    async def get_trend(
        metric: str, range: Literal["1M", "3M", "6M", "1Y", "ALL"] = "3M"
    ) -> dict[str, Any]:
        """A metric's smoothed trend over a range, with change, weekly rate, min and max.
        Metrics include weight_kg, body_fat_pct, fat_mass_kg, lean_mass_kg, muscle_mass_kg,
        waist_cm, navy_body_fat_pct, energy_kcal, protein_g, tdee_kcal."""
        if metric not in METRICS:
            raise ToolError(f"Unknown metric. Choose one of: {', '.join(METRICS)}")
        out = await run(
            lambda c, u: series.get_series(
                metric=metric, range_key=range, user_id=u, conn=c, now=deps.now()
            )
        )
        data = _json(out)
        trend = data.pop("trend")
        step = max(1, len(trend) // MAX_TREND_POINTS)
        data["trend"] = trend[::step] + ([trend[-1]] if trend and len(trend) % step != 1 else [])
        data.pop("points", None)  # raw readings; the trend is what matters
        return data

    @server.tool(annotations=READ)
    async def get_food_day(day: date | None = None) -> dict[str, Any]:
        """Everything logged on a day (default today) with totals and the targets in force.
        Entry ids can be used with delete_food_entry."""
        return _json(
            await run(lambda c, u: food_log.get_day(day=day, user_id=u, conn=c, now=deps.now()))
        )

    @server.tool(annotations=READ)
    async def get_targets() -> dict[str, Any] | None:
        """The calorie, protein, carb, fat and fibre targets in force today."""
        return _json(
            await run(lambda c, u: nutrition.current_targets(user_id=u, conn=c, now=deps.now()))
        )

    @server.tool(annotations=READ)
    async def get_trophies() -> list[dict[str, Any]]:
        """Earned trophies with dates, and locked ones with progress."""
        rows = await run(lambda c, u: achievements.list_achievements(user_id=u, conn=c))
        return [{k: v for k, v in _json(r).items() if k != "new"} for r in rows]

    @server.tool(annotations=READ)
    async def search_foods(query: str) -> dict[str, Any]:
        """Searches the user's own foods and the food databases (Open Food Facts, USDA).
        Results carry nutrients per 100 g. Log one with log_food: by `id` when it has one,
        otherwise by `source` and `source_ref`."""
        if len(query.strip()) < 3:
            raise ToolError("Use at least 3 characters")
        out = await run(
            lambda c, u: foods.search(
                q=query.strip()[:100],
                external=True,
                user_id=u,
                conn=c,
                sources=deps.sources(deps.settings()),
            )
        )
        data = _json(out)
        keep = ("id", "source", "source_ref", "name", "brand", "nutrients_per_100g", "servings")
        for key in ("local", "external"):
            data[key] = [{k: f[k] for k in keep} for f in data[key][:10]]
        return data

    # --- logging ------------------------------------------------------------------------------

    @server.tool(annotations=WRITE)
    async def log_weigh_in(
        weight_kg: float,
        body_fat_pct: float | None = None,
        muscle_mass_kg: float | None = None,
        day: date | None = None,
    ) -> dict[str, Any]:
        """Logs a weigh-in (now, or at 07:00 on a past day). Body fat and muscle mass are
        optional readings from a smart scale."""

        def log(c: Conn, u: UUID) -> Any:
            profile = load_profile(c, u)
            tz = profile.tz if profile else UTC_ZONE
            now = deps.now()
            at = (
                now
                if day is None or day == local_today(now, profile)
                else (datetime.combine(day, time(7), tz))
            )
            body = BodyEntryIn(
                measured_at=at,
                weight_kg=weight_kg,
                body_fat_pct=body_fat_pct,
                muscle_mass_kg=muscle_mass_kg,
            )
            return create_entry(body=body, user_id=u, conn=c, now=now)

        return _json(await run(log))

    @server.tool(annotations=WRITE)
    async def log_food(
        grams: float,
        meal: Meal,
        food_id: UUID | None = None,
        source: Literal["off", "usda"] | None = None,
        source_ref: str | None = None,
        day: date | None = None,
    ) -> dict[str, Any]:
        """Logs an amount of a food found with search_foods: pass its `id`, or for a database
        result without one, its `source` and `source_ref`. Nutrients are scaled from the food."""

        def log(c: Conn, u: UUID) -> Any:
            fid = food_id
            if fid is None:
                if source is None or not source_ref:
                    raise ToolError("Pass food_id, or source and source_ref")
                imported = foods.import_external(
                    body=ImportIn(source=source, source_ref=source_ref),
                    user_id=u,
                    conn=c,
                    sources=deps.sources(deps.settings()),
                )
                fid = imported.id
            body = FoodLogIn(
                food_id=fid, grams=grams, meal=meal, eaten_at=eaten_at(c, u, day, meal)
            )
            return food_log.log_food(body=body, user_id=u, conn=c, now=deps.now())

        return _json(await run(log))

    @server.tool(annotations=WRITE)
    async def quick_add(
        name: str,
        energy_kcal: float,
        meal: Meal,
        protein_g: float | None = None,
        carbs_g: float | None = None,
        fat_g: float | None = None,
        day: date | None = None,
    ) -> dict[str, Any]:
        """Logs calories (and optionally macros) without a food, e.g. a restaurant meal. Prefer
        log_food when the food can be found."""
        nutrients = {"energy_kcal": energy_kcal}
        for key, value in (("protein_g", protein_g), ("carbs_g", carbs_g), ("fat_g", fat_g)):
            if value is not None:
                nutrients[key] = value

        def log(c: Conn, u: UUID) -> Any:
            body = QuickAddIn(
                name=name, nutrients=nutrients, meal=meal, eaten_at=eaten_at(c, u, day, meal)
            )
            return food_log.quick_add(body=body, user_id=u, conn=c, now=deps.now())

        return _json(await run(log))

    @server.tool(annotations=WRITE)
    async def create_food(
        name: str,
        energy_kcal: float,
        protein_g: float | None = None,
        carbs_g: float | None = None,
        fat_g: float | None = None,
        per: Literal["100g", "serving"] = "100g",
        serving_grams: float | None = None,
        serving_label: str | None = None,
        brand: str | None = None,
        barcode: str | None = None,
        is_liquid: bool = False,
        other_nutrients: dict[str, float] | None = None,
    ) -> dict[str, Any]:
        """Saves a custom food to the user's own foods, e.g. from a nutrition label, a
        restaurant's published values or a home recipe. Search first so it isn't a duplicate.

        Give the numbers per 100 g (per="100g"), or per serving (per="serving" with
        serving_grams, the serving's weight in grams); they are stored per 100 g. A serving
        label and grams (e.g. "1 bar", 45) add a serving size the app offers when logging.
        other_nutrients takes any of: fiber_g, sugar_g, sat_fat_g, sodium_mg, potassium_mg,
        calcium_mg, iron_mg, magnesium_mg, zinc_mg, vit_d_mcg, vit_b12_mcg, vit_c_mg,
        vit_a_mcg, folate_mcg. Leave out what the label doesn't give rather than guessing.
        Returns the food with its id, ready for log_food."""
        nutrients = {"energy_kcal": energy_kcal}
        for key, value in (("protein_g", protein_g), ("carbs_g", carbs_g), ("fat_g", fat_g)):
            if value is not None:
                nutrients[key] = value
        nutrients.update(other_nutrients or {})
        if per == "serving" and serving_grams is None:
            raise ToolError("Give serving_grams with per='serving'")

        def create(c: Conn, u: UUID) -> Any:
            servings = (
                [ServingIn(label=serving_label or "1 serving", grams=serving_grams)]
                if serving_grams is not None
                else []
            )
            body = CustomFoodIn(
                name=name,
                brand=brand,
                barcode=barcode,
                servings=servings,
                is_liquid=is_liquid,
                nutrients_per_100g=nutrients if per == "100g" else None,
                nutrients_per_serving=nutrients if per == "serving" else None,
                serving_grams=serving_grams if per == "serving" else None,
            )
            return foods.create_food(body=body, user_id=u, conn=c)

        return _json(await run(create))

    @server.tool(
        annotations=ToolAnnotations(
            read_only_hint=False, destructive_hint=True, open_world_hint=False
        )
    )
    async def delete_food_entry(entry_id: UUID) -> str:
        """Deletes one food log entry (ids come from get_food_day)."""
        await run(lambda c, u: food_log.delete_entry(entry_id=entry_id, user_id=u, conn=c))
        return "Deleted"

    return server


def mcp_transport_security() -> TransportSecuritySettings:
    # The SDK's DNS-rebinding guard is for servers on localhost. This one is public and every
    # request needs an OAuth token, so the Host header check would only get in the way.
    return TransportSecuritySettings(enable_dns_rebinding_protection=False)
