"""In-memory food sources for tests and end-to-end runs (FOOD_SOURCES=fake)."""

from app.food_sources import ExternalSource, FoodDraft


class FakeFoodSource:
    def __init__(self, name: ExternalSource, drafts: list[FoodDraft], fail: bool = False) -> None:
        self.name = name
        self.drafts = drafts
        self.fail = fail
        self.calls = 0

    def _call(self) -> None:
        self.calls += 1
        if self.fail:
            raise ConnectionError(f"{self.name} is down")

    def search(self, query: str, country: str) -> list[FoodDraft]:
        self._call()
        q = query.strip().lower()
        hits = [d for d in self.drafts if q in d.name.lower() or q in (d.brand or "").lower()]
        return sorted(hits, key=lambda d: country not in d.countries)

    def by_barcode(self, code: str) -> FoodDraft | None:
        self._call()
        return next((d for d in self.drafts if d.barcode == code), None)

    def detail(self, source_ref: str) -> FoodDraft | None:
        self._call()
        return next((d for d in self.drafts if d.source_ref == source_ref), None)


IL = ("en:israel",)

DEMO_OFF = [
    FoodDraft(
        source="off",
        source_ref="7290000000017",
        name="Demo hummus",
        brand="צבר",
        barcode="7290000000017",
        nutrients_per_100g={
            "energy_kcal": 270,
            "protein_g": 7,
            "carbs_g": 12,
            "fat_g": 21,
            "fiber_g": 6,
            "sodium_mg": 420,
        },
        servings=[{"label": "2 tbsp", "grams": 30}],
        countries=IL,
    ),
    FoodDraft(
        source="off",
        source_ref="7290000066318",
        name="במבה",
        brand="אסם",
        barcode="7290000066318",
        nutrients_per_100g={"energy_kcal": 534, "protein_g": 15, "carbs_g": 51, "fat_g": 31},
        servings=[{"label": "25 g", "grams": 25}],
        countries=IL,
    ),
    FoodDraft(
        source="off",
        source_ref="7290004131074",
        name="Milk 3% fat",
        brand="תנובה",
        barcode="7290004131074",
        nutrients_per_100g={
            "energy_kcal": 60,
            "protein_g": 3.3,
            "carbs_g": 4.7,
            "fat_g": 3,
            "calcium_mg": 120,
        },
        servings=[{"label": "1 glass", "grams": 250}],
        is_liquid=True,
        countries=IL,
    ),
]

DEMO_USDA = [
    FoodDraft(
        source="usda",
        source_ref="171477",
        name="Chicken, broilers or fryers, breast, meat only, cooked, roasted",
        brand=None,
        barcode=None,
        nutrients_per_100g={
            "energy_kcal": 165,
            "protein_g": 31,
            "carbs_g": 0,
            "fat_g": 3.57,
            "sodium_mg": 74,
            "vit_b12_mcg": 0.34,
        },
    ),
    FoodDraft(
        source="usda",
        source_ref="171705",
        name="Avocados, raw, all commercial varieties",
        brand=None,
        barcode=None,
        nutrients_per_100g={
            "energy_kcal": 160,
            "protein_g": 2,
            "carbs_g": 8.53,
            "fat_g": 14.66,
            "fiber_g": 6.7,
            "potassium_mg": 485,
        },
        servings=[{"label": "1 cup, cubes", "grams": 150}],
    ),
]


def default_sources() -> dict[str, FakeFoodSource]:
    return {
        "off": FakeFoodSource("off", list(DEMO_OFF)),
        "usda": FakeFoodSource("usda", list(DEMO_USDA)),
    }
