from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import current_user_id
from app.db import Conn, get_conn
from app.nutrition_schemas import FoodOut
from app.services.food_service import FOOD_COLUMNS, food_out, visible_food

router = APIRouter(prefix="/favourites", tags=["favourites"])


@router.get("", response_model=list[FoodOut])
def list_favourites(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> list[FoodOut]:
    cols = ", ".join(f"f.{c.strip()}" for c in FOOD_COLUMNS.split(","))
    rows = conn.execute(
        f"select {cols} from food_favourites fav join foods f on f.id = fav.food_id"
        " where fav.user_id = %s and not f.archived order by lower(f.name)",
        (user_id,),
    ).fetchall()
    return [food_out(r, user_id) for r in rows]


@router.put("/{food_id}", status_code=204)
def add_favourite(
    food_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    if visible_food(conn, user_id, food_id) is None:
        raise HTTPException(status_code=404, detail="Food not found")
    conn.execute(
        "insert into food_favourites (user_id, food_id) values (%s, %s) on conflict do nothing",
        (user_id, food_id),
    )
    return Response(status_code=204)


@router.delete("/{food_id}", status_code=204)
def remove_favourite(
    food_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn, scope="function"),
) -> Response:
    conn.execute(
        "delete from food_favourites where user_id = %s and food_id = %s", (user_id, food_id)
    )
    return Response(status_code=204)
