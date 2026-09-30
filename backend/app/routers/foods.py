from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from psycopg.types.json import Jsonb

from app.auth import current_user_id
from app.db import Conn, get_conn
from app.food_sources import FoodSource, get_food_sources
from app.nutrition_schemas import CustomFoodIn, FoodOut, FoodSearchOut, ImportIn
from app.services.food_service import (
    FOOD_COLUMNS,
    SourcesUnavailable,
    food_in_use,
    food_out,
    import_food,
    lookup_barcode,
    own_custom_food,
    search_foods,
    visible_food,
)

router = APIRouter(prefix="/foods", tags=["foods"])
UNAVAILABLE = "Food database unavailable. Please try again."


@router.get("/search", response_model=FoodSearchOut)
def search(
    q: Annotated[str, Query(min_length=3, max_length=100)],
    external: bool = True,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    sources: dict[str, FoodSource] = Depends(get_food_sources),
) -> FoodSearchOut:
    local, found, failed = search_foods(conn, user_id, q, sources, external)
    return FoodSearchOut(local=local, external=found, sources_failed=failed)


@router.get("/barcode/{code}", response_model=FoodOut)
def by_barcode(
    code: Annotated[str, Path(pattern=r"^[0-9]{6,14}$")],
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    sources: dict[str, FoodSource] = Depends(get_food_sources),
) -> FoodOut:
    try:
        row = lookup_barcode(conn, user_id, code, sources)
    except SourcesUnavailable as exc:
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return food_out(row, user_id)


@router.post("/import", response_model=FoodOut)
def import_external(
    body: ImportIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
    sources: dict[str, FoodSource] = Depends(get_food_sources),
) -> FoodOut:
    source = sources.get(body.source)
    if source is None:
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    try:
        row = import_food(conn, source, body.source_ref)
    except SourcesUnavailable as exc:
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return food_out(row, user_id)


@router.get("/mine", response_model=list[FoodOut])
def my_foods(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[FoodOut]:
    rows = conn.execute(
        f"select {FOOD_COLUMNS} from foods"
        " where user_id = %s and source = 'custom' and not archived order by lower(name)",
        (user_id,),
    ).fetchall()
    return [food_out(r, user_id) for r in rows]


@router.get("/{food_id}", response_model=FoodOut)
def get_food(
    food_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> FoodOut:
    row = visible_food(conn, user_id, food_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return food_out(row, user_id)


def _values(body: CustomFoodIn) -> dict[str, Any]:
    return {
        "name": body.name,
        "brand": body.brand or None,
        "barcode": body.barcode,
        "servings": Jsonb([s.model_dump() for s in body.servings]),
        "is_liquid": body.is_liquid,
        "nutrients_per_100g": Jsonb(body.per_100g()),
    }


@router.post("", response_model=FoodOut, status_code=201)
def create_food(
    body: CustomFoodIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> FoodOut:
    v = _values(body)
    row = conn.execute(
        f"""
        insert into foods (user_id, source, name, brand, barcode, servings, is_liquid,
                           nutrients_per_100g)
        values (%s, 'custom', %s, %s, %s, %s, %s, %s)
        returning {FOOD_COLUMNS}
        """,
        (user_id, *v.values()),
    ).fetchone()
    assert row is not None
    return food_out(row, user_id)


@router.put("/{food_id}", response_model=FoodOut)
def update_food(
    food_id: UUID,
    body: CustomFoodIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> FoodOut:
    if own_custom_food(conn, user_id, food_id) is None:
        raise HTTPException(status_code=404, detail="Not found")
    v = _values(body)
    row = conn.execute(
        f"""
        update foods set name = %s, brand = %s, barcode = %s, servings = %s, is_liquid = %s,
                         nutrients_per_100g = %s
        where id = %s and user_id = %s
        returning {FOOD_COLUMNS}
        """,
        (*v.values(), food_id, user_id),
    ).fetchone()
    assert row is not None
    return food_out(row, user_id)


@router.delete("/{food_id}", status_code=204)
def delete_food(
    food_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    if own_custom_food(conn, user_id, food_id) is None:
        raise HTTPException(status_code=404, detail="Not found")
    if food_in_use(conn, food_id):
        # past days, recipes or saved meals still point at it; hide it instead
        conn.execute("update foods set archived = true where id = %s", (food_id,))
    else:
        conn.execute("delete from foods where id = %s", (food_id,))
    return Response(status_code=204)
