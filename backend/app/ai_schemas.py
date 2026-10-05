from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.ai.service import FEATURES

FeatureName = Literal[
    "food_photo", "weekly_report", "body_fat", "meal_plan", "recipe_from_groceries"
]
assert set(FeatureName.__args__) == set(FEATURES)  # type: ignore[attr-defined]


class AIStatusOut(BaseModel):
    enabled: bool  # configured on the server and switched on by the user
    configured: bool
    provider: str | None
    model: str | None
    used_this_month: int
    limit: int
    resets_on: date


class AISettingsIn(BaseModel):
    enabled: bool = True
    acknowledged: list[FeatureName] = Field(default=[], max_length=len(FEATURES))


class AISettingsOut(AISettingsIn):
    pass


class FoodPhotoItemOut(BaseModel):
    name: str
    grams: float
    nutrients: dict[str, float]  # energy_kcal, protein_g, carbs_g, fat_g for `grams`
    confidence: Literal["low", "medium", "high"]
    search_query: str


class FoodPhotoResultOut(BaseModel):
    items: list[FoodPhotoItemOut]
    notes: str
    dropped: int  # items left out because their numbers weren't plausible


class BodyFatIn(BaseModel):
    photo_ids: list[UUID] = Field(min_length=1, max_length=3)


class BodyFatEstimateOut(BaseModel):
    id: UUID
    taken_on: date
    photo_ids: list[UUID]
    low_pct: float
    estimate_pct: float
    high_pct: float
    notes: str
    created_at: datetime
