from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import current_user_id
from app.db import Conn, get_conn
from app.nutrition_schemas import RecipeIn, RecipeOut
from app.services.recipe_service import (
    RECIPE_COLUMNS,
    delete_recipe,
    get_recipe,
    recipe_out,
    save_recipe,
)

router = APIRouter(prefix="/recipes", tags=["recipes"])


@router.get("", response_model=list[RecipeOut])
def list_recipes(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[RecipeOut]:
    rows = conn.execute(
        f"select {RECIPE_COLUMNS} from recipes where user_id = %s and not archived"
        " order by lower(name)",
        (user_id,),
    ).fetchall()
    return [recipe_out(conn, r) for r in rows]


@router.get("/{recipe_id}", response_model=RecipeOut)
def read_recipe(
    recipe_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> RecipeOut:
    recipe = get_recipe(conn, user_id, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Not found")
    return recipe_out(conn, recipe)


@router.post("", response_model=RecipeOut, status_code=201)
def create_recipe(
    body: RecipeIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> RecipeOut:
    return save_recipe(conn, user_id, body)


@router.put("/{recipe_id}", response_model=RecipeOut)
def update_recipe(
    recipe_id: UUID,
    body: RecipeIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> RecipeOut:
    return save_recipe(conn, user_id, body, recipe_id)


@router.delete("/{recipe_id}", status_code=204)
def remove_recipe(
    recipe_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    if not delete_recipe(conn, user_id, recipe_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
