"""Request/response models for the nutrition API (sub-project 2)."""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, PrivateAttr, StringConstraints, model_validator

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
