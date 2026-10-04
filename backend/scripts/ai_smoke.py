"""Run the food-photo prompt once against the configured AI provider, to check a vendor setup.

    cd backend
    AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... python scripts/ai_smoke.py path/to/meal.jpg
    AI_PROVIDER=google GOOGLE_API_KEY=... AI_MODEL=<gemini model> python scripts/ai_smoke.py meal.jpg

Costs one real request. Nothing is written to the database.
"""

import sys
from pathlib import Path

from app.ai.factory import get_provider
from app.ai.prompts import food_photo
from app.ai.provider import AIImage, AIRequest, MediaType
from app.config import Settings

TYPES: dict[str, MediaType] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = Path(sys.argv[1])
    provider = get_provider(Settings())
    if provider is None:
        sys.exit("AI_PROVIDER is 'none'. Set it to anthropic or google.")
    result = provider.generate(
        AIRequest(
            feature="food_photo",
            prompt_version=food_photo.PROMPT_VERSION,
            system=food_photo.SYSTEM,
            text=food_photo.user_text(None),
            schema=food_photo.FoodPhotoOut,
            images=[AIImage(path.read_bytes(), TYPES[path.suffix.lower()])],
        )
    )
    print(f"{provider.name} · {result.model} · {result.latency_ms} ms")
    print(f"tokens in/out: {result.usage.input_tokens}/{result.usage.output_tokens}")
    for item in result.value.items:
        print(
            f"- {item.name}: {item.grams:.0f} g, {item.energy_kcal:.0f} kcal,"
            f" P {item.protein_g:.0f} C {item.carbs_g:.0f} F {item.fat_g:.0f} ({item.confidence})"
        )
    if result.value.notes:
        print(f"notes: {result.value.notes}")


if __name__ == "__main__":
    main()
