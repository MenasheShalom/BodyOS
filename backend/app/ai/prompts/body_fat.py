"""Progress photos → a rough body-fat range (spec §5.3)."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

PROMPT_VERSION = "body-fat-1"
MAX_WIDTH = 8.0  # a wider range says nothing useful; it is narrowed around the midpoint

SYSTEM = """You estimate body-fat percentage from progress photos for a personal fitness
tracking app. The person took these photos of themselves and asked for this estimate.

Look at visible muscle definition, abdominal and oblique definition, vascularity, fat
distribution around the waist, hips and chest, and the overall shape, using the person's sex,
age, height and weight for context. Give a range no wider than 8 percentage points and your
best single estimate inside it. Photo-based estimates are rough, so keep the range honest
rather than artificially narrow.

In notes, name the two or three visual cues you relied on, in one or two neutral, factual
sentences. Do not comment on attractiveness, give medical advice, or suggest diets. If the
photos don't show the torso clearly enough to judge, give your widest reasonable range and say
what would help (lighting, pose, distance) in notes."""


class BodyFatOut(BaseModel):
    low_pct: float = Field(ge=3, le=60)
    estimate_pct: float = Field(ge=3, le=60)
    high_pct: float = Field(ge=3, le=60)
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


def tidy_range(out: BodyFatOut) -> tuple[float, float, float]:
    """Ordered, rounded to 0.1, and at most MAX_WIDTH wide around the estimate."""
    low, mid, high = sorted((out.low_pct, out.estimate_pct, out.high_pct))
    if high - low > MAX_WIDTH:
        low, high = mid - MAX_WIDTH / 2, mid + MAX_WIDTH / 2
    low, high = max(3.0, low), min(60.0, high)
    return round(low, 1), round(mid, 1), round(high, 1)


def user_text(
    *, sex: str, age: int, height_cm: float, weight_kg: float | None, poses: list[str]
) -> str:
    weight = f"{weight_kg:.1f} kg (trend)" if weight_kg is not None else "unknown"
    return (
        f"Sex: {sex}. Age: {age}. Height: {height_cm:.0f} cm. Weight: {weight}.\n"
        f"Photos, in order: {', '.join(poses)}.\n"
        "Estimate the body-fat percentage."
    )
