"""Connection settings for OpenAI-compatible model providers."""
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr

from backend.config import settings
from backend.llm.client import reasoning_efforts
from backend.llm.compatibility import ProbeOutputLimit, check_extraction_compatibility
from backend.llm.pricing import is_openrouter, public_tariff
from backend.storage.workspace import ModelConfig, load_compatibility, load_model, save_compatibility, save_model

router = APIRouter(prefix="/api/model-settings")


class ProviderRequest(BaseModel):
    base_url: str = Field(max_length=2048)
    api_key: SecretStr | None = None


class ModelRequest(ProviderRequest):
    model: str = Field(min_length=1, max_length=256)
    input_price: float | None = Field(default=None, ge=0, le=1_000_000)
    output_price: float | None = Field(default=None, ge=0, le=1_000_000)
    currency: str = Field(default="CNY", pattern="^[A-Z]{3}$")


class CompatibilityRequest(BaseModel):
    base_url: str = Field(max_length=2048)
    model: str = Field(min_length=1, max_length=256)


def require_local_origin(request: Request) -> None:
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    origin = request.headers.get("origin")
    if (request.client and request.client.host not in local_hosts) or (
        origin and (urlsplit(origin).scheme not in {"http", "https"} or urlsplit(origin).hostname not in local_hosts)
    ):
        raise HTTPException(403, "请从本机 PaperMind 页面操作。")


def provider_credentials(payload: ProviderRequest) -> tuple[str, str, bool]:
    url = payload.base_url.strip().rstrip("/")
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        parsed.port
    except ValueError:
        raise HTTPException(422, "Base URL 格式无效。") from None
    if (
        not host or parsed.username is not None or parsed.query or parsed.fragment
        or (parsed.scheme != "https" and not (parsed.scheme == "http" and host in {"localhost", "127.0.0.1", "::1"}))
    ):
        raise HTTPException(422, "请使用 HTTPS Base URL，本机服务也可使用 HTTP。")
    current = load_model()
    supplied = payload.api_key.get_secret_value().strip() if payload.api_key else ""
    environment_url = settings.DEEPSEEK_BASE_URL.rstrip("/")
    key = supplied or (current.api_key if url == current.base_url else "")
    if not key and url == environment_url:
        key = settings.DEEPSEEK_API_KEY
    if not key:
        raise HTTPException(422, "请输入此服务的 API Key。")
    if not key.isascii() or any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise HTTPException(422, "API Key 格式无效。")
    use_environment_key = not supplied and url == environment_url and key == settings.DEEPSEEK_API_KEY
    return url, key, use_environment_key


async def discover_models(url: str, key: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            response = await client.get(f"{url}/models", headers={"Authorization": f"Bearer {key}"})
            response.raise_for_status()
            rows = response.json().get("data", [])
            models = sorted({row["id"] for row in rows if isinstance(row, dict) and isinstance(row.get("id"), str)})
    except (httpx.HTTPError, httpx.InvalidURL, ValueError, AttributeError, TypeError):
        raise HTTPException(502, "无法获取模型列表，请检查 Base URL、API Key 和服务商权限。") from None
    if not models:
        raise HTTPException(502, "服务商没有返回可选模型。")
    return models


@router.get("")
def get_model_settings() -> dict:
    config = load_model()
    return model_settings_view(config)


def model_settings_view(config: ModelConfig) -> dict:
    return {
        **config.public(), "compatibility": load_compatibility(config),
        "reasoning_efforts": reasoning_efforts(config.base_url, config.model),
        "official_pricing": public_tariff(config.base_url, config.model),
        "provider_reported_cost": "openrouter" if is_openrouter(config.base_url) else None,
    }


@router.post("/models")
async def get_available_models(payload: ProviderRequest, request: Request) -> dict:
    require_local_origin(request)
    url, key, _ = provider_credentials(payload)
    models = await discover_models(url, key)
    return {"models": models, "reasoning_efforts": {
        model: efforts for model in models if (efforts := reasoning_efforts(url, model))
    }}


@router.post("/compatibility")
async def test_model_compatibility(payload: CompatibilityRequest, request: Request) -> dict:
    require_local_origin(request)
    config = load_model()
    if (payload.base_url, payload.model) != (config.base_url, config.model):
        raise HTTPException(409, "已保存的模型配置发生变化，请重新打开模型设置。")
    if not config.api_key:
        raise HTTPException(422, "请先保存模型和 API Key。")
    try:
        result = await check_extraction_compatibility(config)
    except ProbeOutputLimit:
        raise HTTPException(502, "测试输出超出长度上限，暂时无法判断兼容性。") from None
    except RuntimeError:
        raise HTTPException(502, "本次测试未能完成，请检查服务连接、API Key 和额度后重试。") from None
    save_compatibility(config, result)
    return result


@router.put("")
async def put_model_settings(payload: ModelRequest, request: Request) -> dict:
    require_local_origin(request)
    if (payload.input_price is None) != (payload.output_price is None):
        raise HTTPException(422, "请同时填写输入和输出单价，或同时清空两项。")
    url, key, use_environment_key = provider_credentials(payload)
    if payload.model not in await discover_models(url, key):
        raise HTTPException(422, "请选择服务商返回的模型。")
    config = ModelConfig(url, payload.model, key, payload.input_price, payload.output_price, payload.currency)
    try:
        save_model(config, use_environment_key=use_environment_key)
    except (OSError, RuntimeError):
        raise HTTPException(500, "本机无法加密保存 API Key。") from None
    return model_settings_view(config)
