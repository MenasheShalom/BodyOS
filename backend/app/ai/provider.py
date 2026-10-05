"""The one interface the app uses to talk to a model, whichever vendor is behind it."""

import copy
from dataclasses import dataclass, field
from typing import Any, Generic, Literal, Protocol, TypeVar

from pydantic import BaseModel

Feature = Literal["food_photo", "weekly_report", "body_fat", "meal_plan", "recipe_from_groceries"]
MediaType = Literal["image/jpeg", "image/png", "image/webp"]

T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True)
class AIImage:
    data: bytes
    media_type: MediaType


@dataclass(frozen=True)
class AIRequest(Generic[T]):
    feature: Feature
    prompt_version: str
    system: str  # constant per feature, so vendors can cache it
    text: str
    schema: type[T]
    images: list[AIImage] = field(default_factory=list)
    max_output_tokens: int = 4000


@dataclass(frozen=True)
class AIUsage:
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass(frozen=True)
class AIResult(Generic[T]):
    value: T
    usage: AIUsage
    model: str
    latency_ms: int


class AIError(Exception):
    """Base for failures an adapter reports in vendor-neutral terms."""


class AIUnavailable(AIError):
    """Network trouble, timeouts, rate limits or server errors at the vendor."""


class AIRefused(AIError):
    """The model declined the request on safety grounds."""


class AIInvalidOutput(AIError):
    """The answer didn't match the schema (or was cut off)."""


class AIConfigError(AIError):
    """Missing or rejected credentials, unknown model."""


class AIProvider(Protocol):
    name: str
    model: str

    def generate(self, request: AIRequest[T]) -> AIResult[T]: ...


def sniff_media_type(data: bytes) -> MediaType | None:
    """The image type from the file's first bytes, not its name or declared type."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def parse_output(schema: type[T], text: str) -> T:
    try:
        return schema.model_validate_json(text)
    except ValueError as e:
        raise AIInvalidOutput(str(e)) from e


_DROP = {"title", "default", "examples"}
_BOUNDS = (
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
)


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """The model's JSON schema in the subset both vendors' constrained decoding accepts:
    `$defs` inlined, every object closed with all properties required, and numeric/length
    bounds moved into the description (Pydantic still enforces them on the way back)."""
    schema = copy.deepcopy(model.model_json_schema())
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(n) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return walk(copy.deepcopy(defs[node["$ref"].split("/")[-1]]))
        bounds = [f"{k}={node[k]}" for k in _BOUNDS if k in node]
        out = {k: walk(v) for k, v in node.items() if k not in _DROP and k not in _BOUNDS}
        if bounds:
            note = "(" + ", ".join(bounds) + ")"
            out["description"] = f"{out['description']} {note}" if "description" in out else note
        if out.get("type") == "object" and "properties" in out:
            out["required"] = list(out["properties"])
            out["additionalProperties"] = False
        return out

    result: dict[str, Any] = walk(schema)
    return result
