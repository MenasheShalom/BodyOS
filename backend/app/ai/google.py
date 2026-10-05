"""Gemini adapter (official `google-genai` SDK). Imported only when AI_PROVIDER=google."""

import time
from typing import Any

from app.ai.provider import (
    AIConfigError,
    AIInvalidOutput,
    AIRefused,
    AIRequest,
    AIResult,
    AIUnavailable,
    AIUsage,
    T,
    parse_output,
    strict_json_schema,
)

REFUSED = {
    "SAFETY",
    "PROHIBITED_CONTENT",
    "BLOCKLIST",
    "SPII",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "RECITATION",
}


class GoogleProvider:
    name = "google"

    def __init__(
        self,
        api_key: str | None,
        model: str | None,
        effort: str = "medium",
        timeout_s: float = 60,
        client: Any = None,
    ) -> None:
        if not model:
            # Gemini model names change too often for a safe built-in default.
            raise AIConfigError("AI_MODEL must name a Gemini model when AI_PROVIDER=google")
        if client is None:
            if not api_key:
                raise AIConfigError("GOOGLE_API_KEY is not set")
            try:
                from google import genai
            except ImportError as e:
                raise AIConfigError("The google-genai package isn't installed") from e

            client = genai.Client(api_key=api_key)
        self._client = client
        self.model = model
        self._effort = effort
        self._timeout_ms = int(timeout_s * 1000)
        self._thinking_supported = True

    def _config(self, request: AIRequest[T]) -> Any:
        from google.genai import types

        return types.GenerateContentConfig(
            system_instruction=request.system,
            response_mime_type="application/json",
            response_json_schema=strict_json_schema(request.schema),
            max_output_tokens=request.max_output_tokens,
            http_options=types.HttpOptions(timeout=self._timeout_ms),
            thinking_config=(
                types.ThinkingConfig(thinking_level=self._effort.upper())
                if self._thinking_supported
                else None
            ),
        )

    def _call(self, request: AIRequest[T]) -> Any:
        from google.genai import errors, types

        contents: list[Any] = [
            types.Part.from_bytes(data=i.data, mime_type=i.media_type) for i in request.images
        ]
        contents.append(request.text)
        try:
            return self._client.models.generate_content(
                model=self.model, contents=contents, config=self._config(request)
            )
        except errors.ClientError as e:
            # Google answers a bad key with 400 API_KEY_INVALID, not 401.
            if e.code in (401, 403) or "api key" in str(e.message).lower():
                raise AIConfigError(f"Google rejected the API key: {e.message}") from e
            if e.code == 404:
                raise AIConfigError(self._unknown_model_message()) from e
            if e.code == 429:
                raise AIUnavailable(e.message or "rate limited") from e
            if e.code == 400 and self._thinking_supported and "thinking" in str(e.message).lower():
                # Older models don't take a thinking level; remember and retry without it.
                self._thinking_supported = False
                return self._call(request)
            raise AIInvalidOutput(f"Google rejected the request: {e.message}") from e
        except errors.ServerError as e:
            raise AIUnavailable(e.message or "server error") from e
        except (TimeoutError, OSError) as e:
            raise AIUnavailable(str(e)) from e

    def _unknown_model_message(self) -> str:
        """Names a few models this key can use, since AI_MODEL is the usual culprit."""
        message = f"Gemini has no model called {self.model!r} (check AI_MODEL)"
        try:
            names = [
                m.name.removeprefix("models/")
                for m in self._client.models.list()
                if m.name and "generateContent" in (m.supported_actions or [])
            ]
        except Exception:  # the hint is best-effort; the real error is the 404
            return message
        flash = [n for n in names if "flash" in n] or names
        return f"{message}. Available models include: {', '.join(flash[:6])}" if flash else message

    def generate(self, request: AIRequest[T]) -> AIResult[T]:
        started = time.monotonic()
        response = self._call(request)
        latency_ms = int((time.monotonic() - started) * 1000)

        feedback = getattr(response, "prompt_feedback", None)
        if feedback is not None and getattr(feedback, "block_reason", None):
            raise AIRefused("The model declined this request")
        candidates = response.candidates or []
        if not candidates:
            raise AIInvalidOutput("The answer was empty")
        finish = getattr(candidates[0].finish_reason, "name", str(candidates[0].finish_reason))
        if finish in REFUSED:
            raise AIRefused("The model declined this request")
        if finish == "MAX_TOKENS":
            raise AIInvalidOutput("The answer was cut off")
        text = response.text
        if not text:
            raise AIInvalidOutput("The answer had no text")
        meta = response.usage_metadata
        usage = AIUsage(
            getattr(meta, "prompt_token_count", None), getattr(meta, "candidates_token_count", None)
        )
        model = getattr(response, "model_version", None) or self.model
        return AIResult(parse_output(request.schema, text), usage, model, latency_ms)
