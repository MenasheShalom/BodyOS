"""Claude adapter (official `anthropic` SDK). Imported only when AI_PROVIDER=anthropic."""

import base64
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

DEFAULT_MODEL = "claude-opus-5-5"
# Re-runs a request the model declines on Anthropic's recommended fallback model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        api_key: str | None,
        model: str | None = None,
        effort: str = "medium",
        timeout_s: float = 60,
        client: Any = None,
    ) -> None:
        if client is None:
            if not api_key:
                raise AIConfigError("ANTHROPIC_API_KEY is not set")
            import anthropic

            client = anthropic.Anthropic(api_key=api_key, timeout=timeout_s, max_retries=1)
        self._client = client
        self.model = model or DEFAULT_MODEL
        self._effort = effort

    def _content(self, request: AIRequest[T]) -> list[dict[str, Any]]:
        images = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": i.media_type,
                    "data": base64.standard_b64encode(i.data).decode("ascii"),
                },
            }
            for i in request.images
        ]
        return [*images, {"type": "text", "text": request.text}]

    def generate(self, request: AIRequest[T]) -> AIResult[T]:
        import anthropic

        started = time.monotonic()
        try:
            response = self._client.beta.messages.create(
                model=self.model,
                max_tokens=request.max_output_tokens,
                system=[
                    {"type": "text", "text": request.system, "cache_control": {"type": "ephemeral"}}
                ],
                messages=[{"role": "user", "content": self._content(request)}],
                output_config={
                    "effort": self._effort,
                    "format": {"type": "json_schema", "schema": strict_json_schema(request.schema)},
                },
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
            raise AIConfigError(f"Anthropic rejected the API key: {e.message}") from e
        except anthropic.NotFoundError as e:
            raise AIConfigError(f"Unknown Anthropic model {self.model!r}") from e
        except anthropic.BadRequestError as e:
            raise AIInvalidOutput(f"Anthropic rejected the request: {e.message}") from e
        except (anthropic.APIConnectionError, anthropic.RateLimitError) as e:
            raise AIUnavailable(str(e)) from e
        except anthropic.APIStatusError as e:
            if e.status_code >= 500:
                raise AIUnavailable(e.message) from e
            raise AIInvalidOutput(e.message) from e
        latency_ms = int((time.monotonic() - started) * 1000)

        if response.stop_reason == "refusal":
            raise AIRefused("The model declined this request")
        if response.stop_reason == "max_tokens":
            raise AIInvalidOutput("The answer was cut off")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise AIInvalidOutput("The answer had no text")
        usage = AIUsage(response.usage.input_tokens, response.usage.output_tokens)
        return AIResult(parse_output(request.schema, text), usage, response.model, latency_ms)
