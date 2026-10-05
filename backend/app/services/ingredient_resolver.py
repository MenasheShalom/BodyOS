"""Turns the ingredients an AI plan names into real foods with real numbers (spec §5.4).

Each search term is tried against the user's own and cached foods first, then USDA's generic
foods, then Open Food Facts for whatever is still missing. OFF is rate limited, so only a few
leftovers go there. The first plausible match wins; an ingredient with none comes back
unresolved for the user to swap by hand.
"""

import logging
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.calculations.nutrition import scale
from app.db import Conn
from app.food_sources import FoodDraft, FoodSource
from app.nutrition_schemas import FoodOut
from app.services.food_service import (
    FOOD_COLUMNS,
    SOURCES_TIMEOUT_S,
    _escape_like,
    food_country,
    food_out,
    upsert_draft,
)

logger = logging.getLogger("bodyos.foods")

MAX_WORKERS = 6
MAX_OFF_LOOKUPS = 3
MAX_WORDS = 6


@dataclass(frozen=True)
class Resolved:
    food: FoodOut
    nutrients: dict[str, float]  # for the ingredient's grams


def _key(query: str) -> str:
    return " ".join(query.lower().split())


def _plausible(nutrients: dict[str, Any]) -> bool:
    return nutrients.get("energy_kcal") is not None


def _local(conn: Conn, user_id: UUID, query: str) -> dict[str, Any] | None:
    """A food whose name or brand contains every word of the query, own foods first.
    Recipes are left out: plans and recipes are built from plain ingredients."""
    words = query.split()[:MAX_WORDS]
    if not words:
        return None
    clauses = " and ".join(["(name || ' ' || coalesce(brand, '')) ilike %s"] * len(words))
    rows = conn.execute(
        f"select {FOOD_COLUMNS} from foods"
        " where (user_id = %s or user_id is null) and not archived and source <> 'recipe'"
        f"   and {clauses}"
        " order by user_id is null, char_length(name) limit 5",
        (user_id, *(f"%{_escape_like(w)}%" for w in words)),
    ).fetchall()
    return next((r for r in rows if _plausible(r["nutrients_per_100g"])), None)


def _search_all(source: FoodSource, queries: list[str], country: str) -> dict[str, FoodDraft]:
    """The first plausible draft for each query, searched in parallel. A query whose search
    fails or times out is simply left unresolved."""
    found: dict[str, FoodDraft] = {}
    if not queries:
        return found
    pool = ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(queries)))
    try:
        futures = {q: pool.submit(source.search, q, country) for q in queries}
        wait(futures.values(), timeout=SOURCES_TIMEOUT_S)
        for query, future in futures.items():
            if not future.done():
                logger.warning("food source %s timed out on %r", source.name, query)
            elif (exc := future.exception()) is not None:
                logger.warning("food source %s failed on %r: %r", source.name, query, exc)
            else:
                draft = next((d for d in future.result() if _plausible(d.nutrients_per_100g)), None)
                if draft is not None:
                    found[query] = draft
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return found


def resolve(
    conn: Conn,
    user_id: UUID,
    sources: dict[str, FoodSource],
    queries: list[str],
) -> dict[str, FoodOut]:
    """Search terms (as given) → the food chosen for each. Missing keys are unresolved."""
    unique: dict[str, str] = {}
    for q in queries:
        if _key(q):
            unique.setdefault(_key(q), q.strip())
    rows: dict[str, dict[str, Any]] = {}
    for key in unique:
        row = _local(conn, user_id, key)
        if row is not None:
            rows[key] = row

    country = food_country(conn, user_id)
    for name, limit in (("usda", None), ("off", MAX_OFF_LOOKUPS)):
        source = sources.get(name)
        missing = [k for k in unique if k not in rows][:limit]
        if source is None or not missing:
            continue
        for key, draft in _search_all(source, missing, country).items():
            rows[key] = upsert_draft(conn, draft)

    return {
        original: food_out(rows[key], user_id)
        for original in queries
        if (key := _key(original)) in rows
    }


def nutrients_for(food: FoodOut, grams: float) -> dict[str, float]:
    return {k: round(v, 1) for k, v in scale(food.nutrients_per_100g, grams).items()}


def add_up(items: list[dict[str, float]]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for nutrients in items:
        for k, v in nutrients.items():
            totals[k] = totals.get(k, 0.0) + v
    return {k: round(v, 1) for k, v in totals.items()}
