import json
from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import errors as genai_errors

from app.ai.anthropic import AnthropicProvider
from app.ai.fake import FakeProvider
from app.ai.google import GoogleProvider
from app.ai.prompts import food_photo
from app.ai.provider import (
    AIConfigError,
    AIImage,
    AIInvalidOutput,
    AIRefused,
    AIRequest,
    AIUnavailable,
    strict_json_schema,
)

ANSWER = {
    "items": [
        {
            "name": "Hummus",
            "grams": 60,
            "energy_kcal": 162,
            "protein_g": 4.8,
            "carbs_g": 8.4,
            "fat_g": 12,
            "confidence": "high",
            "search_query": "hummus",
        }
    ],
    "notes": "",
}


def _request(text: str = "Estimate the food in this photo.") -> AIRequest[food_photo.FoodPhotoOut]:
    return AIRequest(
        feature="food_photo",
        prompt_version=food_photo.PROMPT_VERSION,
        system=food_photo.SYSTEM,
        text=text,
        schema=food_photo.FoodPhotoOut,
        images=[AIImage(b"\xff\xd8\xffjpeg", "image/jpeg")],
    )


def _walk(node: Any) -> Any:
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def test_strict_schema_closes_objects_and_moves_bounds() -> None:
    schema = strict_json_schema(food_photo.FoodPhotoOut)
    assert "$defs" not in json.dumps(schema)
    for node in _walk(schema):
        assert "$ref" not in node and "title" not in node and "minimum" not in node
        if node.get("type") == "object":
            assert node["additionalProperties"] is False
            assert node["required"] == list(node["properties"])
    grams = schema["properties"]["items"]["items"]["properties"]["grams"]
    assert "minimum=1" in grams["description"] and "maximum=2000" in grams["description"]


def test_fake_provider_answers_and_fails_on_markers() -> None:
    fake = FakeProvider()
    assert len(fake.generate(_request()).value.items) == 3
    assert fake.generate(_request("x __empty__")).value.items == []
    for marker, error in [
        ("__refuse__", AIRefused),
        ("__unavailable__", AIUnavailable),
        ("__invalid__", AIInvalidOutput),
    ]:
        with pytest.raises(error):
            fake.generate(_request(marker))


# --- Anthropic -------------------------------------------------------------------------


class StubAnthropic:
    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._response, self._error = response, error
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return self._response


def _claude(text: str, stop_reason: str = "end_turn") -> Any:
    return SimpleNamespace(
        stop_reason=stop_reason,
        content=[SimpleNamespace(type="thinking"), SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=1500, output_tokens=200),
        model="claude-opus-5-5",
    )


def test_anthropic_request_shape_and_result() -> None:
    stub = StubAnthropic(_claude(json.dumps(ANSWER)))
    result = AnthropicProvider(None, effort="low", client=stub).generate(_request())
    assert result.value.items[0].name == "Hummus"
    assert (result.usage.input_tokens, result.usage.output_tokens) == (1500, 200)
    call = stub.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"]["effort"] == "low"
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert call["system"][0]["text"] == food_photo.SYSTEM
    image, text = call["messages"][0]["content"]
    assert image["source"]["media_type"] == "image/jpeg" and text["type"] == "text"
    assert "temperature" not in call


def test_anthropic_refusal_and_truncation() -> None:
    with pytest.raises(AIRefused):
        AnthropicProvider(None, client=StubAnthropic(_claude("", "refusal"))).generate(_request())
    with pytest.raises(AIInvalidOutput):
        AnthropicProvider(None, client=StubAnthropic(_claude("{", "max_tokens"))).generate(
            _request()
        )
    with pytest.raises(AIInvalidOutput):
        AnthropicProvider(None, client=StubAnthropic(_claude('{"items": 3}'))).generate(_request())


def test_anthropic_errors_are_translated() -> None:
    import anthropic
    import httpx

    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")

    def status(cls: type[anthropic.APIStatusError], code: int) -> anthropic.APIStatusError:
        return cls("boom", response=httpx.Response(code, request=req), body=None)

    cases = [
        (anthropic.APIConnectionError(request=req), AIUnavailable),
        (status(anthropic.RateLimitError, 429), AIUnavailable),
        (status(anthropic.InternalServerError, 500), AIUnavailable),
        (status(anthropic.AuthenticationError, 401), AIConfigError),
        (status(anthropic.NotFoundError, 404), AIConfigError),
        (status(anthropic.BadRequestError, 400), AIInvalidOutput),
    ]
    for error, expected in cases:
        with pytest.raises(expected):
            AnthropicProvider(None, client=StubAnthropic(error=error)).generate(_request())


def test_anthropic_needs_a_key() -> None:
    with pytest.raises(AIConfigError):
        AnthropicProvider(None)


# --- Google ----------------------------------------------------------------------------


class StubGemini:
    def __init__(self, responses: list[Any]) -> None:
        self.calls: list[dict[str, Any]] = []
        self._responses = responses
        self.models = SimpleNamespace(generate_content=self._generate)

    def _generate(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _gemini(text: str, finish: str = "STOP", blocked: bool = False) -> Any:
    return SimpleNamespace(
        prompt_feedback=SimpleNamespace(block_reason="SAFETY" if blocked else None),
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name=finish))],
        text=text,
        usage_metadata=SimpleNamespace(prompt_token_count=900, candidates_token_count=150),
        model_version="gemini-test",
    )


def test_google_request_shape_and_result() -> None:
    stub = StubGemini([_gemini(json.dumps(ANSWER))])
    result = GoogleProvider(None, "gemini-test", effort="high", client=stub).generate(_request())
    assert result.value.items[0].grams == 60
    assert (result.usage.input_tokens, result.usage.output_tokens, result.model) == (
        900,
        150,
        "gemini-test",
    )
    call = stub.calls[0]
    assert call["model"] == "gemini-test"
    image, text = call["contents"]
    assert image.inline_data.mime_type == "image/jpeg" and text == _request().text
    config = call["config"]
    assert config.response_mime_type == "application/json"
    assert config.system_instruction == food_photo.SYSTEM
    assert config.thinking_config.thinking_level.name == "HIGH"


def test_google_needs_a_model() -> None:
    with pytest.raises(AIConfigError):
        GoogleProvider("key", None)


def test_google_refusals_and_truncation() -> None:
    for response, error in [
        (_gemini("", blocked=True), AIRefused),
        (_gemini("", finish="SAFETY"), AIRefused),
        (_gemini("{", finish="MAX_TOKENS"), AIInvalidOutput),
        (_gemini("not json"), AIInvalidOutput),
    ]:
        with pytest.raises(error):
            GoogleProvider(None, "m", client=StubGemini([response])).generate(_request())


def test_google_errors_are_translated() -> None:
    def err(cls: type[genai_errors.APIError], code: int, message: str = "boom") -> Exception:
        return cls(code, {"error": {"code": code, "message": message, "status": "X"}})

    for error, expected in [
        (err(genai_errors.ServerError, 503), AIUnavailable),
        (err(genai_errors.ClientError, 429), AIUnavailable),
        (err(genai_errors.ClientError, 403), AIConfigError),
        (err(genai_errors.ClientError, 404), AIConfigError),
        (err(genai_errors.ClientError, 400), AIInvalidOutput),
    ]:
        # an outage is retried once, so give the stub the same error twice
        stub = StubGemini([error, error])
        with pytest.raises(expected):
            GoogleProvider(None, "m", client=stub, sleep=lambda _: None).generate(_request())


def test_google_retries_a_brief_outage_once() -> None:
    overloaded = genai_errors.ServerError(
        503, {"error": {"code": 503, "message": "The model is overloaded.", "status": "X"}}
    )
    waits: list[float] = []
    stub = StubGemini([overloaded, _gemini(json.dumps(ANSWER))])
    result = GoogleProvider(None, "m", client=stub, sleep=waits.append).generate(_request())
    assert result.value.items[0].name == "Hummus"
    assert waits == [2.0] and len(stub.calls) == 2

    stub = StubGemini([overloaded, overloaded])
    with pytest.raises(AIUnavailable, match="Google error 503: The model is overloaded."):
        GoogleProvider(None, "m", client=stub, sleep=lambda _: None).generate(_request())


def test_google_drops_thinking_when_the_model_rejects_it() -> None:
    rejection = genai_errors.ClientError(
        400, {"error": {"code": 400, "message": "Thinking level is not supported", "status": "X"}}
    )
    stub = StubGemini([rejection, _gemini(json.dumps(ANSWER)), _gemini(json.dumps(ANSWER))])
    provider = GoogleProvider(None, "old-model", client=stub)
    provider.generate(_request())
    provider.generate(_request())
    assert stub.calls[0]["config"].thinking_config is not None
    assert [c["config"].thinking_config for c in stub.calls[1:]] == [None, None]


def test_missing_sdk_is_a_config_error(monkeypatch) -> None:
    import builtins

    real_import = builtins.__import__

    def no_sdks(name: str, *args: Any, **kwargs: Any) -> Any:
        if name in ("google", "anthropic"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_sdks)
    with pytest.raises(AIConfigError, match="google-genai"):
        GoogleProvider("key", "m")
    with pytest.raises(AIConfigError, match="anthropic"):
        AnthropicProvider("key")


def test_unknown_gemini_model_suggests_available_ones() -> None:
    missing = genai_errors.ClientError(
        404, {"error": {"code": 404, "message": "models/x is not found", "status": "NOT_FOUND"}}
    )
    stub = StubGemini([missing])
    stub.models.list = lambda: [
        SimpleNamespace(name="models/gemini-test-flash", supported_actions=["generateContent"]),
        SimpleNamespace(name="models/text-embedding", supported_actions=["embedContent"]),
        SimpleNamespace(name="models/gemini-test-pro", supported_actions=["generateContent"]),
    ]
    with pytest.raises(AIConfigError) as e:
        GoogleProvider(None, "gemini-typo", client=stub).generate(_request())
    assert str(e.value) == (
        "Gemini has no model called 'gemini-typo' (check AI_MODEL)."
        " Available models include: gemini-test-flash"
    )


def test_invalid_google_key_is_a_config_error() -> None:
    bad_key = genai_errors.ClientError(
        400,
        {
            "error": {
                "code": 400,
                "message": "API key not valid. Please pass a valid API key.",
                "status": "INVALID_ARGUMENT",
            }
        },
    )
    with pytest.raises(AIConfigError, match="API key not valid"):
        GoogleProvider(None, "m", client=StubGemini([bad_key])).generate(_request())
