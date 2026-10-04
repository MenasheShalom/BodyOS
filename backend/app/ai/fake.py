"""Deterministic provider for tests and end-to-end runs (AI_PROVIDER=fake)."""

import json
from pathlib import Path
from typing import Any

from app.ai.provider import (
    AIInvalidOutput,
    AIRefused,
    AIRequest,
    AIResult,
    AIUnavailable,
    AIUsage,
    T,
    parse_output,
)

FIXTURES = Path(__file__).parent / "fixtures"


class FakeProvider:
    """Answers each feature from `fixtures/<feature>.json`. Markers in the request text drive
    the failure paths: `__refuse__`, `__unavailable__`, `__invalid__`, `__empty__`."""

    name = "fake"

    def __init__(self, model: str = "fake-1") -> None:
        self.model = model
        self.requests: list[AIRequest[Any]] = []

    def generate(self, request: AIRequest[T]) -> AIResult[T]:
        self.requests.append(request)
        if "__refuse__" in request.text:
            raise AIRefused("fake refusal")
        if "__unavailable__" in request.text:
            raise AIUnavailable("fake outage")
        if "__invalid__" in request.text:
            raise AIInvalidOutput("fake invalid output")
        data = json.loads((FIXTURES / f"{request.feature}.json").read_text())
        if "__empty__" in request.text:
            data = {"items": [], "notes": "No food is visible in this photo."}
        value = parse_output(request.schema, json.dumps(data))
        return AIResult(value, AIUsage(1200, 300), self.model, latency_ms=5)
