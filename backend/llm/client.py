"""DeepSeek LLM 客户端：基于 OpenAI 兼容接口（DeepSeek 兼容 OpenAI API）"""
import asyncio
import logging
from contextvars import ContextVar
from datetime import datetime, timezone
from decimal import Decimal
from functools import lru_cache
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

import httpx
from openai import AsyncOpenAI, BadRequestError

from backend.config import settings
from backend.llm.pricing import (
    TOKENS_PER_MILLION, cached_input_tokens, is_openrouter, official_tariff, reported_request_cost,
)
from backend.storage.workspace import ModelConfig

logger = logging.getLogger(__name__)

class ModelRequestRejected(RuntimeError):
    """Provider rejected the request format before generation."""


class DeepSeekClient:
    """DeepSeek 异步客户端，封装 OpenAI 兼容的 Chat Completions 接口"""

    def __init__(self, config: ModelConfig | None = None, on_usage: Callable[[dict], None] | None = None) -> None:
        # DeepSeek 兼容 OpenAI API，直接复用 AsyncOpenAI
        base_url = config.base_url if config else settings.DEEPSEEK_BASE_URL
        self.client = AsyncOpenAI(
            api_key=config.api_key if config else settings.DEEPSEEK_API_KEY,
            base_url=base_url,
            timeout=settings.LLM_TIMEOUT,
            http_client=httpx.AsyncClient(timeout=settings.LLM_TIMEOUT, follow_redirects=False),
        )
        self.model = config.model if config else settings.DEEPSEEK_MODEL
        self.official_deepseek = urlsplit(base_url).hostname == "api.deepseek.com"
        self.timeout = settings.LLM_TIMEOUT
        self.max_retries = settings.TOOL_MAX_RETRIES
        self.config = config
        self.on_usage = on_usage
        self.input_tokens = 0
        self.output_tokens = 0
        self.cached_tokens = 0
        self.unknown_cache_tokens = 0
        self.cost_low = Decimal(0)
        self.cost_high = Decimal(0)
        self.openrouter = bool(config and is_openrouter(base_url))
        self.reported_cost = Decimal(0)
        self.billed_calls = 0
        self.tariff = official_tariff(base_url, self.model) if config and config.input_price is None and config.output_price is None else None
        self.measured_calls = 0
        self.unmeasured_calls = 0

    def usage(self) -> dict:
        config = self.config
        low = high = None
        source = None
        currency = config.currency if config else None
        if self.billed_calls:
            low = high = float(self.reported_cost)
            source = "openrouter_reported"
            currency = "USD"
        elif self.measured_calls and self.tariff:
            low, high = float(self.cost_low), float(self.cost_high)
            source = "deepseek_official"
            currency = "CNY"
        elif self.measured_calls and config and config.input_price is not None and config.output_price is not None:
            low = high = float(
                (self.input_tokens * Decimal(str(config.input_price)) + self.output_tokens * Decimal(str(config.output_price)))
                / TOKENS_PER_MILLION
            )
            source = "custom"
        return {
            "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
            "measured_calls": self.measured_calls, "unmeasured_calls": self.unmeasured_calls,
            "cached_input_tokens": self.cached_tokens, "unknown_cache_input_tokens": self.unknown_cache_tokens,
            "estimated_cost": high, "estimated_cost_lower": low if low != high else None,
            "cost_source": source, "currency": currency,
            "partially_priced": 0 < self.billed_calls < self.measured_calls + self.unmeasured_calls,
        }

    def record_usage(self, response: Any, requested_at: datetime | None = None) -> None:
        usage = getattr(response, "usage", None)
        if self.openrouter:
            reported = reported_request_cost(usage)
            if reported is not None:
                self.reported_cost += reported
                self.billed_calls += 1
        input_tokens = getattr(usage, "prompt_tokens", None)
        output_tokens = getattr(usage, "completion_tokens", None)
        if type(input_tokens) is int and input_tokens >= 0 and type(output_tokens) is int and output_tokens >= 0:
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens
            self.measured_calls += 1
            hits = cached_input_tokens(usage, input_tokens)
            if hits is None:
                self.unknown_cache_tokens += input_tokens
            else:
                self.cached_tokens += hits
            if self.tariff:
                timestamp = getattr(response, "created", None)
                billed_at = requested_at or datetime.now(timezone.utc)
                if type(timestamp) is int and timestamp > 0:
                    try:
                        billed_at = datetime.fromtimestamp(timestamp, timezone.utc)
                    except (OverflowError, OSError, ValueError):
                        pass
                low, high = self.tariff.estimate(input_tokens, output_tokens, hits, billed_at)
                self.cost_low += low
                self.cost_high += high
        else:
            self.unmeasured_calls += 1
        if self.on_usage:
            self.on_usage(self.usage())

    async def chat(
        self,
        messages: list[dict],
        tools: Optional[list[dict]] = None,
        tool_choice: str | dict = "auto",
        max_tokens: Optional[int] = None,
    ) -> Any:
        """调用 Chat Completions，返回模型回复（ChatCompletion 对象）

        单次调用失败时按指数退避重试 max_retries 次。
        max_tokens: 显式设置输出 token 上限，None 用 API 默认值（4096）。
        """
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
            # Named choices are unavailable in thinking mode, and the tool loop
            # uses standard assistant/tool messages rather than reasoning history.
            if self.official_deepseek:
                kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        total_attempts = self.max_retries + 1  # 初次调用 + 重试次数
        for attempt in range(total_attempts):
            requested_at = datetime.now(timezone.utc)
            try:
                # 显式超时控制，确保单次调用不会无限挂起
                response = await asyncio.wait_for(
                    self.client.chat.completions.create(**kwargs),
                    timeout=self.timeout,
                )
            except Exception as exc:
                logger.warning(
                    "模型调用失败 (attempt=%d/%d): %s",
                    attempt + 1,
                    total_attempts,
                    type(exc).__name__,
                )
                if isinstance(exc, BadRequestError):
                    self.record_usage(None)
                    raise ModelRequestRejected(
                        "模型拒绝了分析请求（HTTP 400），请检查所选模型是否支持此步骤。"
                    ) from None
                if attempt < self.max_retries:
                    # 指数退避：1s, 2s, 4s ...
                    backoff = 2 ** attempt
                    await asyncio.sleep(backoff)
            else:
                self.record_usage(response, requested_at)
                return response

        self.record_usage(None)
        raise RuntimeError(
            f"模型调用失败，已重试 {self.max_retries} 次"
        )


task_client: ContextVar[DeepSeekClient | None] = ContextVar("task_client", default=None)


@lru_cache(maxsize=1)
def default_client() -> DeepSeekClient:
    return DeepSeekClient()


def get_client() -> DeepSeekClient:
    return task_client.get() or default_client()
