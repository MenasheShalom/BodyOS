"""What to aim for in the next session of an exercise, from the last time it was done
(double progression: add reps up to the top of the range, then add weight)."""

from dataclasses import dataclass
from typing import Literal

Kind = Literal["reps", "time"]


@dataclass(frozen=True)
class Spec:
    kind: Kind
    sets: int
    reps_low: int | None
    reps_high: int | None
    seconds: int | None
    uses_weight: bool


@dataclass(frozen=True)
class DoneSet:
    weight_kg: float | None
    reps: int | None
    seconds: int | None


@dataclass(frozen=True)
class Suggestion:
    weight_kg: float | None
    reps: int | None
    seconds: int | None
    note: str


def increment(weight_kg: float) -> float:
    """Small jumps for light weights (dumbbells, isolation work), 2.5 kg above 20 kg."""
    return 2.5 if weight_kg >= 20 else 1.0


def suggest(spec: Spec, last: list[DoneSet]) -> Suggestion:
    done = [s for s in last if (s.seconds if spec.kind == "time" else s.reps)]
    if spec.kind == "time":
        target = spec.seconds or 30
        if not done:
            return Suggestion(None, None, target, "")
        if len(done) >= spec.sets and all((s.seconds or 0) >= target for s in done):
            return Suggestion(None, None, target + 5, "Held it every set: 5 seconds longer")
        return Suggestion(None, None, target, "Same time, hold it on every set")

    low, high = spec.reps_low or 8, spec.reps_high or 12
    if not done:
        note = f"Pick a weight you could lift about {high + 2} times" if spec.uses_weight else ""
        return Suggestion(None, low, None, note)
    reps = [s.reps or 0 for s in done]
    all_top = len(done) >= spec.sets and min(reps) >= high
    weights = [s.weight_kg for s in done if s.weight_kg is not None]
    weight = max(weights) if weights else None

    if spec.uses_weight and weight is not None:
        if all_top:
            return Suggestion(
                weight + increment(weight), low, None, "Hit the top of the range: add weight"
            )
        return Suggestion(weight, min(high, min(reps) + 1), None, "Same weight, one more rep")
    if all_top:
        return Suggestion(
            None, high, None, "Top of the range: try a harder variation or slower reps"
        )
    return Suggestion(None, min(high, min(reps) + 1), None, "One more rep than last time")
