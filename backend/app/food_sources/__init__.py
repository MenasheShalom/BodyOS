from dataclasses import dataclass, field
from typing import Literal, Protocol, TypedDict

from fastapi import Depends

from app.config import Settings, get_settings
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


_live: dict[tuple[str, str], dict[str, FoodSource]] = {}


def get_food_sources(settings: Settings = Depends(get_settings)) -> dict[str, FoodSource]:
    """The external food databases, keyed by source name. Live clients are reused so their
    HTTP connections and response caches survive across requests."""
    from app.food_sources.fake import default_sources
    from app.food_sources.fdc import FdcSource
    from app.food_sources.off import OffSource

    if settings.food_sources == "fake":
        return dict(default_sources())
    key = (settings.off_user_agent, settings.usda_api_key)
    if key not in _live:
        _live[key] = {
            "off": OffSource(settings.off_user_agent),
            "usda": FdcSource(settings.usda_api_key),
        }
    return _live[key]
