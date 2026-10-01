import logging
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb

from app.db import Conn
from app.food_sources import FoodDraft, FoodSource
from app.nutrition_schemas import FoodOut

logger = logging.getLogger("bodyos.foods")

FOOD_COLUMNS = (
    "id, user_id, source, source_ref, barcode, name, brand, nutrients_per_100g, servings,"
    " is_liquid, archived"
)
SEARCH_LIMIT = 20
SOURCES_TIMEOUT_S = 9  # a little over each client's own 8 s timeout
DEFAULT_COUNTRY = "en:israel"


class SourcesUnavailable(Exception):
    pass


def food_out(row: dict[str, Any], user_id: UUID) -> FoodOut:
    return FoodOut(
        id=row["id"],
        source=row["source"],
        source_ref=row["source_ref"],
        barcode=row["barcode"],
        name=row["name"],
        brand=row["brand"],
        nutrients_per_100g=row["nutrients_per_100g"],
        servings=row["servings"],
        is_liquid=row["is_liquid"],
        is_own=row["user_id"] == user_id,
    )


def draft_out(draft: FoodDraft) -> FoodOut:
    return FoodOut(
        id=None,
        source=draft.source,
        source_ref=draft.source_ref,
        barcode=draft.barcode,
        name=draft.name,
        brand=draft.brand,
        nutrients_per_100g=draft.nutrients_per_100g,
        servings=list(draft.servings),
        is_liquid=draft.is_liquid,
        is_own=False,
    )


def visible_food(conn: Conn, user_id: UUID, food_id: UUID) -> dict[str, Any] | None:
    """A food this user may read or log: a shared cached food or one of their own."""
    return conn.execute(
        f"select {FOOD_COLUMNS} from foods where id = %s and (user_id is null or user_id = %s)",
        (food_id, user_id),
    ).fetchone()


def own_custom_food(conn: Conn, user_id: UUID, food_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        f"select {FOOD_COLUMNS} from foods"
        " where id = %s and user_id = %s and source = 'custom' and not archived",
        (food_id, user_id),
    ).fetchone()


def food_in_use(conn: Conn, food_id: UUID) -> bool:
    """Whether a log entry, recipe or saved meal refers to the food."""
    row = conn.execute(
        "select exists (select 1 from food_log where food_id = %(id)s)"
        " or exists (select 1 from recipe_items where food_id = %(id)s)"
        " or exists (select 1 from saved_meal_items where food_id = %(id)s) as used",
        {"id": food_id},
    ).fetchone()
    return bool(row and row["used"])


def food_country(conn: Conn, user_id: UUID) -> str:
    row = conn.execute(
        "select food_country from nutrition_settings where user_id = %s", (user_id,)
    ).fetchone()
    return row["food_country"] if row else DEFAULT_COUNTRY


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_local(conn: Conn, user_id: UUID, query: str) -> list[dict[str, Any]]:
    pattern = f"%{_escape_like(query.strip())}%"
    return conn.execute(
        f"select {FOOD_COLUMNS} from foods"
        " where (user_id = %s or user_id is null) and not archived"
        "   and (name ilike %s or brand ilike %s or barcode = %s)"
        " order by user_id is null, name limit %s",
        (user_id, pattern, pattern, query.strip(), SEARCH_LIMIT),
    ).fetchall()


def search_external(
    sources: dict[str, FoodSource], query: str, country: str
) -> tuple[list[FoodDraft], list[str]]:
    """Query every source in parallel. A source that errors or times out is reported by
    name instead of failing the search."""
    drafts: list[FoodDraft] = []
    failed: list[str] = []
    pool = ThreadPoolExecutor(max_workers=max(len(sources), 1))
    try:
        futures = {name: pool.submit(src.search, query, country) for name, src in sources.items()}
        wait(futures.values(), timeout=SOURCES_TIMEOUT_S)
        for name, future in futures.items():
            if not future.done():
                logger.warning("food source %s timed out", name)
                failed.append(name)
            elif (exc := future.exception()) is not None:
                logger.warning("food source %s failed: %r", name, exc)
                failed.append(name)
            else:
                drafts.extend(future.result())
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return drafts, failed


def search_foods(
    conn: Conn,
    user_id: UUID,
    query: str,
    sources: dict[str, FoodSource],
    external: bool,
) -> tuple[list[FoodOut], list[FoodOut], list[str]]:
    local = search_local(conn, user_id, query)
    if not external:
        return [food_out(r, user_id) for r in local], [], []
    drafts, failed = search_external(sources, query, food_country(conn, user_id))
    known_refs = {(r["source"], r["source_ref"]) for r in local}
    known_barcodes = {r["barcode"] for r in local if r["barcode"]}
    fresh = [
        d
        for d in drafts
        if (d.source, d.source_ref) not in known_refs
        and not (d.barcode and d.barcode in known_barcodes)
    ]
    return [food_out(r, user_id) for r in local], [draft_out(d) for d in fresh], failed


def upsert_draft(conn: Conn, draft: FoodDraft) -> dict[str, Any]:
    row = conn.execute(
        f"""
        insert into foods
          (source, source_ref, barcode, name, brand, nutrients_per_100g, servings, is_liquid)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (source, source_ref) where user_id is null do update set
          barcode = excluded.barcode,
          name = excluded.name,
          brand = excluded.brand,
          nutrients_per_100g = excluded.nutrients_per_100g,
          servings = excluded.servings,
          is_liquid = excluded.is_liquid
        returning {FOOD_COLUMNS}
        """,
        (
            draft.source,
            draft.source_ref,
            draft.barcode,
            draft.name,
            draft.brand,
            Jsonb(draft.nutrients_per_100g),
            Jsonb(list(draft.servings)),
            draft.is_liquid,
        ),
    ).fetchone()
    assert row is not None
    return row


def import_food(conn: Conn, source: FoodSource, source_ref: str) -> dict[str, Any] | None:
    """Fetch a food's full record from its source and cache it. Raises SourcesUnavailable
    when the source can't be reached."""
    try:
        draft = source.detail(source_ref)
    except Exception as exc:
        logger.warning("food source %s failed on detail: %r", source.name, exc)
        raise SourcesUnavailable(source.name) from exc
    return None if draft is None else upsert_draft(conn, draft)


def lookup_barcode(
    conn: Conn, user_id: UUID, code: str, sources: dict[str, FoodSource]
) -> dict[str, Any] | None:
    """Own or cached food first, then each external source in turn (OFF before USDA)."""
    local = conn.execute(
        f"select {FOOD_COLUMNS} from foods"
        " where barcode = %s and (user_id = %s or user_id is null) and not archived"
        " order by user_id is null limit 1",
        (code, user_id),
    ).fetchone()
    if local is not None:
        return local
    failed: list[str] = []
    for name in ("off", "usda"):
        source = sources.get(name)
        if source is None:
            continue
        try:
            draft = source.by_barcode(code)
        except Exception as exc:
            logger.warning("food source %s failed on barcode: %r", name, exc)
            failed.append(name)
            continue
        if draft is not None:
            return upsert_draft(conn, draft)
    if failed:
        raise SourcesUnavailable(", ".join(failed))
    return None
