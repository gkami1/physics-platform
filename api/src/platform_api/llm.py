"""Chat models behind one interface.

Primary: self-hosted vLLM (Qwen3), fallback: DeepSeek API. Both speak the OpenAI chat
completions protocol, so one client covers both. Only `delta.content` is used:
`reasoning_content` (thinking) is never forwarded to the student.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from collections.abc import AsyncGenerator, AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from platform_api.settings import Settings

logger = logging.getLogger("api.llm")

Message = dict[str, str]


@dataclass
class CallInfo:
    """Filled in while a call streams; one per provider attempt (→ llm_calls)."""

    provider: str
    model: str
    started: float = field(default_factory=time.monotonic)
    ttft_ms: int | None = None
    latency_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_kop: int = 0
    error: str | None = None


class ChatModel(Protocol):
    name: str
    model: str

    def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]: ...


class LLMUnavailableError(RuntimeError):
    pass


@dataclass
class OpenAICompatible:
    name: str
    base_url: str
    model: str
    api_key: str = ""
    max_tokens: int = 600
    # Extra request fields, e.g. vLLM's chat_template_kwargs for Qwen3.
    extra: dict[str, Any] = field(default_factory=dict)
    # Prices in kopecks per million tokens (0 for self-hosted).
    price_in: int = 0
    price_out: int = 0
    first_token_timeout: float = 20.0
    transport: httpx.AsyncBaseTransport | None = None  # tests

    async def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]:
        body = {
            "model": self.model,
            "messages": list(messages),
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": self.max_tokens,
            "temperature": 0.7,
            "top_p": 0.8,
            **self.extra,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        timeout = httpx.Timeout(connect=5.0, read=self.first_token_timeout, write=10.0, pool=5.0)
        async with (
            httpx.AsyncClient(
                base_url=self.base_url, timeout=timeout, transport=self.transport
            ) as client,
            client.stream("POST", "/chat/completions", json=body, headers=headers) as r,
        ):
            if r.status_code != 200:
                text = (await r.aread())[:300].decode(errors="replace")
                raise LLMUnavailableError(f"HTTP {r.status_code}: {text}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                chunk = json.loads(data)
                if usage := chunk.get("usage"):
                    info.tokens_in = usage.get("prompt_tokens")
                    info.tokens_out = usage.get("completion_tokens")
                for choice in chunk.get("choices") or []:
                    delta: str | None = (choice.get("delta") or {}).get("content")
                    if delta:
                        yield delta
        info.cost_kop = math.ceil(
            ((info.tokens_in or 0) * self.price_in + (info.tokens_out or 0) * self.price_out)
            / 1_000_000
        )


@dataclass
class ScriptedModel:
    """Local development and tests: streams canned replies, no network."""

    replies: Sequence[str] = (
        "Давай разберёмся вместе. Что известно в условии и какую величину нужно найти? "
        "Подумай, какая формула связывает эти величины.",
    )
    name: str = "scripted"
    model: str = "scripted"
    delay: float = 0.0
    calls: int = 0

    async def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]:
        reply = self.replies[self.calls % len(self.replies)]
        self.calls += 1
        info.tokens_in = sum(len(m["content"]) for m in messages) // 4
        info.tokens_out = len(reply) // 4
        for i in range(0, len(reply), 12):
            if self.delay:
                await asyncio.sleep(self.delay)
            yield reply[i : i + 12]


@dataclass
class FailingModel:
    """Tests: fails before the first token."""

    name: str = "failing"
    model: str = "failing"

    async def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]:
        raise LLMUnavailableError("down")
        yield ""  # pragma: no cover  (makes this an async generator)


async def stream_with_fallback(
    models: Sequence[ChatModel], messages: Sequence[Message], calls: list[CallInfo]
) -> AsyncGenerator[str]:
    """Try models in order. Switch only if a model fails before its first token;
    a failure mid-answer ends the answer (the student already sees part of it)."""
    for i, m in enumerate(models):
        info = CallInfo(provider=m.name, model=m.model)
        calls.append(info)
        started = False
        try:
            async for text in m.stream(messages, info):
                if not started:
                    started = True
                    info.ttft_ms = int((time.monotonic() - info.started) * 1000)
                yield text
            return
        except (httpx.HTTPError, LLMUnavailableError, json.JSONDecodeError) as e:
            info.error = f"{type(e).__name__}: {e}"[:300]
            logger.warning("llm call failed", extra={"provider": m.name, "error": info.error})
            if started or i == len(models) - 1:
                raise LLMUnavailableError(info.error) from e
        finally:
            info.latency_ms = int((time.monotonic() - info.started) * 1000)
    raise LLMUnavailableError("no models configured")


def make_models(settings: Settings) -> list[ChatModel]:
    models: list[ChatModel] = []
    if settings.llm_base_url:
        models.append(
            OpenAICompatible(
                name="primary",
                base_url=settings.llm_base_url,
                model=settings.llm_model,
                api_key=settings.llm_api_key,
                # Qwen3: answer directly; hidden reasoning only adds latency for tutoring.
                extra={"chat_template_kwargs": {"enable_thinking": settings.llm_thinking}},
            )
        )
    if settings.llm_fallback_base_url:
        models.append(
            OpenAICompatible(
                name="fallback",
                base_url=settings.llm_fallback_base_url,
                model=settings.llm_fallback_model,
                api_key=settings.llm_fallback_api_key,
                price_in=settings.llm_fallback_price_in,
                price_out=settings.llm_fallback_price_out,
            )
        )
    if not models and settings.env != "prod":
        models.append(ScriptedModel(delay=0.03))
    return models
