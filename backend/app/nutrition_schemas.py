"""Request/response models for the nutrition API (sub-project 2)."""

from datetime import date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    Field,
    PrivateAttr,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.nutrients import Nutrients, validate_nutrients

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Barcode = Annotated[str, StringConstraints(pattern=r"^[0-9]{6,14}$")]
FoodSourceName = Literal["off", "usda", "custom", "recipe"]


class ServingIn(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    grams: float = Field(gt=0, le=5000)


class CustomFoodIn(BaseModel):
    """Nutrients are given per 100 g or per serving (converted to per 100 g on save)."""

    name: Name
    brand: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    barcode: Barcode | None = None
    servings: list[ServingIn] = Field(default=[], max_length=10)
    is_liquid: bool = False
    nutrients_per_100g: dict[str, float] | None = None
    nutrients_per_serving: dict[str, float] | None = None
    serving_grams: float | None = Field(default=None, gt=0, le=5000)
    _per_100g: Nutrients = PrivateAttr(default_factory=dict)

    @model_validator(mode="after")
    def _one_basis(self) -> Self:
        if (self.nutrients_per_100g is None) == (self.nutrients_per_serving is None):
            raise ValueError("Give nutrients per 100 g or per serving")
        if self.nutrients_per_serving is not None and self.serving_grams is None:
            raise ValueError("Serving size is required")
        self._per_100g = validate_nutrients(self._converted(), per_100g=True)
        return self

    def _converted(self) -> Nutrients:
        if self.nutrients_per_100g is not None:
            return dict(self.nutrients_per_100g)
        assert self.nutrients_per_serving is not None and self.serving_grams is not None
        factor = 100 / self.serving_grams
        return {k: v * factor for k, v in self.nutrients_per_serving.items()}

    def per_100g(self) -> Nutrients:
        return {k: round(v, 3) for k, v in self._per_100g.items()}


class ImportIn(BaseModel):
    source: Literal["off", "usda"]
    source_ref: Annotated[str, StringConstraints(min_length=1, max_length=40)]


class ServingOut(BaseModel):
    label: str
    grams: float


class FoodOut(BaseModel):
    id: UUID | None  # None: an external result not cached yet (import it to log it)
    source: FoodSourceName
    source_ref: str | None
    barcode: str | None
    name: str
    brand: str | None
    nutrients_per_100g: dict[str, float]
    servings: list[ServingOut]
    is_liquid: bool
    is_own: bool


class FoodSearchOut(BaseModel):
    local: list[FoodOut]
    external: list[FoodOut]
    sources_failed: list[str]


Meal = Literal["breakfast", "lunch", "dinner", "snack"]
QUICK_ADD_KEYS = ("energy_kcal", "protein_g", "carbs_g", "fat_g")


def validate_quick_nutrients(n: dict[str, float]) -> Nutrients:
    extra = set(n) - set(QUICK_ADD_KEYS)
    if extra:
        raise ValueError("Quick add takes calories, protein, carbs and fat only")
    out = validate_nutrients(n, per_100g=False)
    if not 0 < out["energy_kcal"] <= 10000:
        raise ValueError("Calories must be between 1 and 10000")
    return out


class FoodLogIn(BaseModel):
    food_id: UUID
    grams: float = Field(ge=0.1, le=5000)
    serving_label: Annotated[str, StringConstraints(max_length=100)] | None = None
    serving_count: float | None = Field(default=None, gt=0, le=100)
    meal: Meal
    eaten_at: AwareDatetime


class QuickAddIn(BaseModel):
    name: Name = "Quick add"
    nutrients: dict[str, float]
    meal: Meal
    eaten_at: AwareDatetime

    @model_validator(mode="after")
    def _check_nutrients(self) -> Self:
        self.nutrients = validate_quick_nutrients(self.nutrients)
        return self


class FoodLogPatch(BaseModel):
    grams: float | None = Field(default=None, ge=0.1, le=5000)
    serving_label: Annotated[str, StringConstraints(max_length=100)] | None = None
    serving_count: float | None = Field(default=None, gt=0, le=100)
    meal: Meal | None = None
    eaten_at: AwareDatetime | None = None
    name: Name | None = None
    nutrients: dict[str, float] | None = None

    @model_validator(mode="after")
    def _required_not_null(self) -> Self:
        for field in ("grams", "meal", "eaten_at", "name", "nutrients"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} can't be empty")
        if self.nutrients is not None:
            self.nutrients = validate_quick_nutrients(self.nutrients)
        return self


class FoodLogOut(BaseModel):
    id: UUID
    eaten_at: datetime
    meal: Meal
    food_id: UUID | None
    name: str
    grams: float | None
    serving_label: str | None
    serving_count: float | None
    nutrients: dict[str, float]
    meal_ref: UUID | None

    @field_validator("nutrients")
    @classmethod
    def _round(cls, n: dict[str, float]) -> dict[str, float]:
        return {k: round(v, 1) for k, v in n.items()}


TargetOrigin = Literal["manual", "suggested"]


class TargetsOut(BaseModel):
    effective_from: date
    energy_kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    fiber_g: int
    origin: TargetOrigin
    tdee_at_creation: int | None


class FoodDayOut(BaseModel):
    day: date
    entries: list[FoodLogOut]
    totals: dict[str, float]
    coverage: dict[str, float]
    target: TargetsOut | None


Mode = Literal["recomp", "cut", "maintain", "lean_bulk"]
ActivityLevel = Literal["sedentary", "light", "moderate", "very"]
# OFF country tags used to rank search results; en:world turns ranking off.
FoodCountry = Literal["en:israel", "en:united-states", "en:united-kingdom", "en:world"]


class NutritionSettingsIn(BaseModel):
    mode: Mode = "recomp"
    deficit_pct: float | None = Field(default=None, ge=-10, le=25)  # None: the mode's default
    protein_g_per_kg: float = Field(default=2.0, ge=1.4, le=3.0)
    activity_level: ActivityLevel = "light"
    check_in_weekday: int = Field(default=6, ge=0, le=6)  # Monday = 0, Sunday = 6
    food_country: FoodCountry = "en:israel"


class NutritionSettingsOut(NutritionSettingsIn):
    configured: bool


class MacroTargets(BaseModel):
    energy_kcal: int = Field(ge=800, le=6000)
    protein_g: int = Field(ge=0, le=500)
    carbs_g: int = Field(ge=0, le=1000)
    fat_g: int = Field(ge=0, le=400)
    fiber_g: int = Field(ge=0, le=150)


class TargetsIn(MacroTargets):
    effective_from: date
    origin: TargetOrigin
    tdee_at_creation: int | None = Field(default=None, ge=500, le=10000)


class EstimateOut(BaseModel):
    bmr: int
    tdee: int
    method: Literal["katch", "mifflin"]
    activity_factor: float
    weight_kg: float
    lean_mass_kg: float | None
    targets: MacroTargets


class RecentFoodOut(BaseModel):
    food: FoodOut
    grams: float
    serving_label: str | None
    serving_count: float | None
    last_eaten_at: datetime


class CopyIn(BaseModel):
    from_day: date
    to_day: date
    meal: Meal | None = None  # None copies the whole day
    to_meal: Meal | None = None  # defaults to the same meal

    @model_validator(mode="after")
    def _to_meal_needs_meal(self) -> Self:
        if self.to_meal is not None and self.meal is None:
            raise ValueError("Choose which meal to copy")
        return self
