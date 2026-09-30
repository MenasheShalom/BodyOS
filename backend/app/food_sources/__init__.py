from dataclasses import dataclass, field
from typing import Literal, Protocol, TypedDict

from app.nutrients import Nutrients

ExternalSource = Literal["off", "usda"]


class Serving(TypedDict):
    label: str
    grams: float


@dataclass(frozen=True)
class FoodDraft:
    """A food from an external database, normalised to our units (per 100 g)."""

    source: ExternalSource
    source_ref: str
    name: str
    brand: str | None
    barcode: str | None
    nutrients_per_100g: Nutrients
    servings: list[Serving] = field(default_factory=list)
    is_liquid: bool = False
    countries: tuple[str, ...] = ()


class FoodSource(Protocol):
    name: ExternalSource

    def search(self, query: str, country: str) -> list[FoodDraft]: ...
    def by_barcode(self, code: str) -> FoodDraft | None: ...
    def detail(self, source_ref: str) -> FoodDraft | None: ...
