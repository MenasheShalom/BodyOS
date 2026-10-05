from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.ai.service import FEATURES
from app.nutrition_schemas import FoodOut, Meal

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
    plan_preferences: str = ""


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


class ReportSectionOut(BaseModel):
    title: str
    body: str
    tone: Literal["good", "watch", "neutral"]


class WeeklyReportOut(BaseModel):
    week_start: date
    facts: dict[str, Any]
    summary: str
    sections: list[ReportSectionOut]
    focus: list[str]
    fallback: bool  # written from a plain template because the AI text didn't check out
    can_regenerate: bool
    created_at: datetime
    updated_at: datetime


class ReportListItemOut(BaseModel):
    week_start: date
    summary: str
    fallback: bool


class ReportsOut(BaseModel):
    current_week_start: date  # the latest check-in day, on or before today
    reports: list[ReportListItemOut]


Preferences = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class MealPlanIn(BaseModel):
    meals: int = Field(ge=2, le=5)
    rest_of_today: bool = False  # plan against what's left today instead of the whole day
    preferences: Preferences = ""  # remembered for next time


class ResolvedIngredientOut(BaseModel):
    name: str  # as the AI wrote it
    search_query: str
    grams: float
    food: FoodOut | None  # None when no food matched; the user swaps it by hand
    nutrients: dict[str, float]  # for `grams`; empty when unresolved


class PlannedMealOut(BaseModel):
    meal: Meal
    title: str
    ingredients: list[ResolvedIngredientOut]
    totals: dict[str, float]


class PlanTargetsOut(BaseModel):
    energy_kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class MealPlanResultOut(BaseModel):
    targets: PlanTargetsOut  # what the plan aimed at: the day's targets or what's left
    rest_of_today: bool
    meals: list[PlannedMealOut]
    totals: dict[str, float]
    unresolved: int
    notes: str


MAX_GROCERIES = 40


class GroceriesIn(BaseModel):
    groceries: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1000)
    ]
    servings: int | None = Field(default=None, ge=1, le=12)
    staples: bool = True  # oil, salt, spices and other pantry basics may be added

    @field_validator("groceries")
    @classmethod
    def _has_items(cls, value: str) -> str:
        if not grocery_list(value):
            raise ValueError("List at least one grocery")
        if len(grocery_list(value)) > MAX_GROCERIES:
            raise ValueError(f"List at most {MAX_GROCERIES} groceries")
        return value


def grocery_list(text: str) -> list[str]:
    """One grocery per line or comma-separated, without bullets or blanks."""
    items = (part.strip(" -*•\t") for line in text.splitlines() for part in line.split(","))
    return [i[:80] for i in items if i]


class RecipeIdeaOut(BaseModel):
    name: str
    servings: int
    minutes: int
    ingredients: list[ResolvedIngredientOut]
    steps: list[str]
    totals: dict[str, float]
    per_serving: dict[str, float]


class RecipeIdeasOut(BaseModel):
    recipes: list[RecipeIdeaOut]
    unresolved: int
    notes: str
