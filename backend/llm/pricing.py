"""DeepSeek CNY token tariffs checked against the official pricing page."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import urlsplit

DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"
PRICING_CHECKED_AT = "2026-11-18"
BEIJING = timezone(timedelta(hours=8))
TOKENS_PER_MILLION = Decimal(1_000_000)

# State Council holiday notices for 2026 and 2027. DeepSeek also discounts
# weekends, including any make-up work days scheduled on a weekend.
HOLIDAYS = {
    2026: (((1, 1), (1, 3)), ((2, 15), (2, 23)), ((4, 4), (4, 6)),
           ((5, 1), (5, 5)), ((6, 19), (6, 21)), ((9, 25), (9, 27)), ((10, 1), (10, 7))),
    2027: (((1, 1), (1, 3)), ((2, 5), (2, 13)), ((4, 3), (4, 5)),
           ((5, 1), (5, 5)), ((6, 9), (6, 9)), ((9, 15), (9, 15)), ((10, 1), (10, 7))),
}


@dataclass(frozen=True)
class Tariff:
    cached_input: Decimal
    uncached_input: Decimal
    output: Decimal

    def public(self, factor: int) -> dict:
        return {
            "cached_input": float(self.cached_input * factor),
            "uncached_input": float(self.uncached_input * factor),
            "output": float(self.output * factor),
        }

    def estimate(
        self, input_tokens: int, output_tokens: int, hits: int | None, billed_at: datetime,
    ) -> tuple[Decimal, Decimal]:
        low_factor, high_factor = rate_factors(billed_at)
        high_hits = hits if hits is not None else 0
        low_hits = hits if hits is not None else input_tokens
        output = output_tokens * self.output
        low = low_hits * self.cached_input + (input_tokens - low_hits) * self.uncached_input + output
        high = high_hits * self.cached_input + (input_tokens - high_hits) * self.uncached_input + output
        return low * low_factor / TOKENS_PER_MILLION, high * high_factor / TOKENS_PER_MILLION


FLASH = Tariff(Decimal("0.02"), Decimal("1"), Decimal("4"))
PRO = Tariff(Decimal("0.15"), Decimal("4.5"), Decimal("13.5"))
DEEPSEEK_TARIFFS = {
    "deepseek-flash": FLASH,
    "deepseek-v4-flash": FLASH,
    "deepseek-v4-flash-vision-exp": FLASH,
    "deepseek-v4-pro": PRO,
}


def official_tariff(base_url: str, model: str) -> Tariff | None:
    url = urlsplit(base_url)
    if url.scheme == "https" and url.hostname == "api.deepseek.com" and url.port in {None, 443}:
        return DEEPSEEK_TARIFFS.get(model)
    return None


def public_tariff(base_url: str, model: str) -> dict | None:
    tariff = official_tariff(base_url, model)
    if tariff is None:
        return None
    return {
        "currency": "CNY", "source_url": DEEPSEEK_PRICING_URL, "checked_at": PRICING_CHECKED_AT,
        "off_peak": tariff.public(1), "peak": tariff.public(2),
    }


def is_openrouter(base_url: str) -> bool:
    url = urlsplit(base_url)
    return (
        url.scheme == "https"
        and url.hostname in {"openrouter.ai", "eu.openrouter.ai", "us.openrouter.ai"}
        and url.port in {None, 443}
    )


def rate_factors(billed_at: datetime) -> tuple[int, int]:
    local = billed_at.astimezone(BEIJING)
    if local.weekday() >= 5 or not (9 <= local.hour < 12 or 14 <= local.hour < 18):
        return 1, 1
    holidays = HOLIDAYS.get(local.year)
    if holidays is None:
        return 1, 2
    if any(date(local.year, *start) <= local.date() <= date(local.year, *end) for start, end in holidays):
        return 1, 1
    return 2, 2


def cached_input_tokens(usage, total: int) -> int | None:
    candidates = (
        getattr(usage, "prompt_cache_hit_tokens", None),
        getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", None),
    )
    for value in candidates:
        if type(value) is int and 0 <= value <= total:
            return value
    misses = getattr(usage, "prompt_cache_miss_tokens", None)
    if type(misses) is int and 0 <= misses <= total:
        return total - misses
    return 0 if total == 0 else None


def reported_request_cost(usage) -> Decimal | None:
    value = getattr(usage, "cost", None)
    if type(value) not in {int, float}:
        return None
    amount = Decimal(str(value))
    return amount if amount.is_finite() and amount >= 0 else None
