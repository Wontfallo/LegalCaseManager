"""
LLM Provider Abstraction Layer.

Supports multiple LLM providers for chat completions and embeddings:
  1. GitHub Copilot  — OAuth device flow, OpenAI-compatible API
  2. Google Gemini   — API key auth, native SDK
  3. LM Studio       — Local, OpenAI-compatible API
  4. Ollama          — Local, OpenAI-compatible API
  5. OpenAI          — API key auth (original)
  6. Mistral         — API key auth (original)

Each provider implements a common interface for:
  - Chat completions (used by extraction_service)
  - Text embeddings  (used by vectorization_service)
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("llm_provider")

# ── Provider Registry ────────────────────────────────────

PROVIDER_CONFIG_PATH = Path("./storage/provider_config.json")


class ProviderType(str, Enum):
    GITHUB_COPILOT = "github_copilot"
    GOOGLE_GEMINI = "google_gemini"
    LM_STUDIO = "lm_studio"
    OLLAMA = "ollama"
    OPENAI = "openai"
    MISTRAL = "mistral"


@dataclass
class ProviderConfig:
    """Stored configuration for a provider."""

    provider_type: ProviderType
    enabled: bool = False
    api_key: str = ""
    base_url: str = ""
    chat_model: str = ""
    embedding_model: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


# Default settings per provider
PROVIDER_DEFAULTS: dict[ProviderType, dict[str, str]] = {
    ProviderType.GITHUB_COPILOT: {
        "base_url": "https://api.githubcopilot.com",
        "chat_model": "gpt-4o",
        "embedding_model": "text-embedding-3-small",
    },
    ProviderType.GOOGLE_GEMINI: {
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "chat_model": "gemini-1.5-pro",
        "embedding_model": "text-embedding-004",
    },
    ProviderType.LM_STUDIO: {
        "base_url": "http://127.0.0.1:1234/v1",
        "chat_model": "",
        "embedding_model": "",
    },
    ProviderType.OLLAMA: {
        "base_url": "http://127.0.0.1:11434/v1",
        "chat_model": "llama3",
        "embedding_model": "nomic-embed-text",
    },
    ProviderType.OPENAI: {
        "base_url": "https://api.openai.com/v1",
        "chat_model": "gpt-4o",
        "embedding_model": "text-embedding-3-small",
    },
    ProviderType.MISTRAL: {
        "base_url": "https://api.mistral.ai/v1",
        "chat_model": "mistral-large-latest",
        "embedding_model": "",
    },
}


# ── GitHub Copilot OAuth Device Flow ─────────────────────

GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token"

# This is the well-known Copilot VS Code client ID — same one OpenCode uses.
# It's public (not a secret) and is embedded in the VS Code Copilot extension.
GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"


@dataclass
class DeviceFlowState:
    """Tracks an in-progress GitHub device flow authentication."""

    device_code: str = ""
    user_code: str = ""
    verification_uri: str = ""
    expires_at: float = 0.0
    interval: int = 5
    status: str = "pending"  # pending, polling, complete, error
    error_message: str = ""
    access_token: str = ""


# Module-level state for device flow (one at a time)
_device_flow_state: DeviceFlowState | None = None


async def start_github_device_flow() -> dict[str, str]:
    """
    Initiate the GitHub OAuth device flow.
    Returns the user_code and verification_uri for the user to visit.
    """
    global _device_flow_state

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GITHUB_DEVICE_CODE_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_COPILOT_CLIENT_ID,
                "scope": "read:user",
            },
        )
        response.raise_for_status()
        data = response.json()

    _device_flow_state = DeviceFlowState(
        device_code=data["device_code"],
        user_code=data["user_code"],
        verification_uri=data.get(
            "verification_uri", "https://github.com/login/device"
        ),
        expires_at=time.time() + data.get("expires_in", 900),
        interval=data.get("interval", 5),
        status="pending",
    )

    logger.info(
        "github_device_flow_started",
        user_code=_device_flow_state.user_code,
        verification_uri=_device_flow_state.verification_uri,
    )

    return {
        "user_code": _device_flow_state.user_code,
        "verification_uri": _device_flow_state.verification_uri,
        "expires_in": data.get("expires_in", 900),
    }


async def poll_github_device_flow() -> dict[str, Any]:
    """
    Poll GitHub to check if the user has authorized the device.
    Returns status and, if complete, saves the token.
    """
    global _device_flow_state

    if _device_flow_state is None:
        return {
            "status": "error",
            "message": "No device flow in progress. Call /start first.",
        }

    if time.time() > _device_flow_state.expires_at:
        _device_flow_state.status = "error"
        _device_flow_state.error_message = "Device code expired. Please start again."
        return {"status": "error", "message": _device_flow_state.error_message}

    _device_flow_state.status = "polling"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_COPILOT_CLIENT_ID,
                "device_code": _device_flow_state.device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
        )
        data = response.json()

    if "access_token" in data:
        # Got the GitHub OAuth token; now exchange for Copilot token
        github_token = data["access_token"]
        copilot_token = await _get_copilot_api_token(github_token)

        if copilot_token:
            existing_config = _load_all_configs().get(ProviderType.GITHUB_COPILOT.value)
            _device_flow_state.status = "complete"
            _device_flow_state.access_token = github_token

            # Save the config
            _save_provider_config(
                ProviderConfig(
                    provider_type=ProviderType.GITHUB_COPILOT,
                    enabled=True,
                    api_key=github_token,
                    base_url=PROVIDER_DEFAULTS[ProviderType.GITHUB_COPILOT]["base_url"],
                    chat_model=(
                        existing_config.chat_model
                        if existing_config and existing_config.chat_model
                        else PROVIDER_DEFAULTS[ProviderType.GITHUB_COPILOT][
                            "chat_model"
                        ]
                    ),
                    embedding_model=(
                        existing_config.embedding_model
                        if existing_config and existing_config.embedding_model
                        else PROVIDER_DEFAULTS[ProviderType.GITHUB_COPILOT][
                            "embedding_model"
                        ]
                    ),
                    extra={
                        "copilot_token": copilot_token["token"],
                        "copilot_expires_at": copilot_token["expires_at"],
                    },
                )
            )

            logger.info("github_copilot_authenticated")
            return {
                "status": "complete",
                "message": "GitHub Copilot connected successfully.",
            }
        else:
            _device_flow_state.status = "error"
            _device_flow_state.error_message = "Got GitHub token but failed to get Copilot API token. Ensure you have an active Copilot subscription."
            return {"status": "error", "message": _device_flow_state.error_message}

    error = data.get("error", "")
    if error == "authorization_pending":
        return {"status": "pending", "message": "Waiting for user to authorize..."}
    elif error == "slow_down":
        _device_flow_state.interval = min(_device_flow_state.interval + 5, 30)
        return {
            "status": "pending",
            "message": "Waiting (slowing down)...",
            "interval": _device_flow_state.interval,
        }
    elif error == "expired_token":
        _device_flow_state.status = "error"
        return {
            "status": "error",
            "message": "Device code expired. Please start again.",
        }
    elif error == "access_denied":
        _device_flow_state.status = "error"
        return {"status": "error", "message": "Authorization denied by user."}
    else:
        _device_flow_state.status = "error"
        _device_flow_state.error_message = data.get(
            "error_description", f"Unknown error: {error}"
        )
        return {"status": "error", "message": _device_flow_state.error_message}


async def _get_copilot_api_token(github_token: str) -> dict[str, Any] | None:
    """
    Exchange a GitHub OAuth token for a short-lived Copilot API token.
    The Copilot token is what actually authorizes API calls.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                COPILOT_TOKEN_URL,
                headers={
                    "Authorization": f"token {github_token}",
                    "Accept": "application/json",
                    "Editor-Version": "vscode/1.99.0",
                    "Editor-Plugin-Version": "copilot-chat/0.26.0",
                },
            )
            response.raise_for_status()
            data = response.json()

            return {
                "token": data.get("token", ""),
                "expires_at": data.get("expires_at", 0),
                "endpoints": data.get("endpoints", {}),
            }
    except httpx.HTTPStatusError as exc:
        logger.error(
            "copilot_token_exchange_failed",
            status=exc.response.status_code,
            detail=exc.response.text[:500],
        )
        return None
    except Exception as exc:
        logger.error("copilot_token_exchange_error", error=str(exc))
        return None


async def _ensure_copilot_token(config: ProviderConfig) -> str:
    """
    Ensure we have a valid (non-expired) Copilot API token.
    Refreshes automatically using the stored GitHub OAuth token.
    """
    copilot_expires = config.extra.get("copilot_expires_at", 0)
    copilot_token = config.extra.get("copilot_token", "")

    # Refresh if expired or expiring within 60 seconds
    if not copilot_token or time.time() > (copilot_expires - 60):
        logger.info("refreshing_copilot_token")
        result = await _get_copilot_api_token(config.api_key)
        if result and result["token"]:
            config.extra["copilot_token"] = result["token"]
            config.extra["copilot_expires_at"] = result["expires_at"]
            _save_provider_config(config)
            return result["token"]
        else:
            raise RuntimeError(
                "Failed to refresh Copilot API token. "
                "Re-authenticate via /api/providers/github-copilot/connect"
            )

    return copilot_token


async def get_copilot_available_models() -> list[dict[str, Any]]:
    """Fetch available models from the Copilot API."""
    config = get_provider_config(ProviderType.GITHUB_COPILOT)
    if not config or not config.api_key:
        raise RuntimeError("GitHub Copilot is not authenticated.")

    token = await _ensure_copilot_token(config)

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{config.base_url}/models",
            headers={
                "Authorization": f"Bearer {token}",
                "Copilot-Integration-Id": "vscode-chat",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        data = response.json()

    models = data.get("data", [])
    result = []
    for m in models:
        model_id = m.get("id", "")
        caps = m.get("capabilities", {})
        model_type = caps.get("type", "chat") if caps else "chat"
        result.append(
            {
                "id": model_id,
                "name": m.get("name", model_id),
                "type": model_type,
            }
        )

    result.sort(key=lambda x: x["id"])
    return result


# ── Config Persistence ───────────────────────────────────


def _load_all_configs() -> dict[str, ProviderConfig]:
    """Load all provider configs from disk."""
    if not PROVIDER_CONFIG_PATH.exists():
        return {}

    try:
        raw = json.loads(PROVIDER_CONFIG_PATH.read_text(encoding="utf-8"))
        configs: dict[str, ProviderConfig] = {}
        for key, val in raw.items():
            try:
                configs[key] = ProviderConfig(
                    provider_type=ProviderType(val["provider_type"]),
                    enabled=val.get("enabled", False),
                    api_key=val.get("api_key", ""),
                    base_url=val.get("base_url", ""),
                    chat_model=val.get("chat_model", ""),
                    embedding_model=val.get("embedding_model", ""),
                    extra=val.get("extra", {}),
                )
            except (KeyError, ValueError) as exc:
                logger.warning("invalid_provider_config", key=key, error=str(exc))
        return configs
    except Exception as exc:
        logger.error("load_provider_config_failed", error=str(exc))
        return {}


def _save_provider_config(config: ProviderConfig) -> None:
    """Save a single provider config (merges with existing).

    When enabling a provider, all other providers are automatically disabled
    so that only one provider is active at a time.
    """
    all_configs = _load_all_configs()

    # Exclusive selection: enabling one provider disables all others.
    if config.enabled:
        for key, cfg in all_configs.items():
            if key != config.provider_type.value:
                cfg.enabled = False

    all_configs[config.provider_type.value] = config

    PROVIDER_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    serialized = {}
    for key, cfg in all_configs.items():
        serialized[key] = {
            "provider_type": cfg.provider_type.value,
            "enabled": cfg.enabled,
            "api_key": cfg.api_key,
            "base_url": cfg.base_url,
            "chat_model": cfg.chat_model,
            "embedding_model": cfg.embedding_model,
            "extra": cfg.extra,
        }

    PROVIDER_CONFIG_PATH.write_text(
        json.dumps(serialized, indent=2),
        encoding="utf-8",
    )
    logger.info("provider_config_saved", provider=config.provider_type.value)


def get_provider_config(provider_type: ProviderType) -> ProviderConfig | None:
    """Get a specific provider config if it exists and is enabled."""
    configs = _load_all_configs()
    cfg = configs.get(provider_type.value)
    if cfg and cfg.enabled:
        return cfg
    return None


def get_all_provider_configs() -> dict[str, ProviderConfig]:
    """Get all saved provider configs."""
    return _load_all_configs()


def save_provider_config_public(config: ProviderConfig) -> None:
    """Public wrapper to save provider config."""
    _save_provider_config(config)


# ── Active Provider Resolution ───────────────────────────


def get_active_chat_provider() -> tuple[ProviderType, ProviderConfig] | None:
    """
    Find the first enabled provider that can do chat completions.
    Priority order: GitHub Copilot > Gemini > OpenAI > Mistral > LM Studio > Ollama
    """
    # Check stored configs first
    priority = [
        ProviderType.GITHUB_COPILOT,
        ProviderType.GOOGLE_GEMINI,
        ProviderType.LM_STUDIO,
        ProviderType.OLLAMA,
    ]

    configs = _load_all_configs()
    for pt in priority:
        cfg = configs.get(pt.value)
        if cfg and cfg.enabled and cfg.chat_model:
            return (pt, cfg)

    # Fall back to .env-based OpenAI/Mistral
    if settings.openai_api_key:
        return (
            ProviderType.OPENAI,
            ProviderConfig(
                provider_type=ProviderType.OPENAI,
                enabled=True,
                api_key=settings.openai_api_key,
                base_url="https://api.openai.com/v1",
                chat_model=settings.openai_chat_model,
                embedding_model=settings.openai_embedding_model,
            ),
        )

    if settings.mistral_api_key:
        return (
            ProviderType.MISTRAL,
            ProviderConfig(
                provider_type=ProviderType.MISTRAL,
                enabled=True,
                api_key=settings.mistral_api_key,
                base_url="https://api.mistral.ai/v1",
                chat_model="mistral-large-latest",
            ),
        )

    return None


def get_active_embedding_provider() -> tuple[ProviderType, ProviderConfig] | None:
    """
    Find the first enabled provider that can do embeddings.
    Priority: OpenAI > GitHub Copilot > Gemini > Ollama
    (LM Studio embedding support is model-dependent)
    """
    # .env-based OpenAI first (best embeddings)
    if settings.openai_api_key:
        return (
            ProviderType.OPENAI,
            ProviderConfig(
                provider_type=ProviderType.OPENAI,
                enabled=True,
                api_key=settings.openai_api_key,
                base_url="https://api.openai.com/v1",
                chat_model=settings.openai_chat_model,
                embedding_model=settings.openai_embedding_model,
            ),
        )

    configs = _load_all_configs()

    priority = [
        ProviderType.GITHUB_COPILOT,
        ProviderType.GOOGLE_GEMINI,
        ProviderType.OLLAMA,
        ProviderType.LM_STUDIO,
    ]

    for pt in priority:
        cfg = configs.get(pt.value)
        if cfg and cfg.enabled and cfg.embedding_model:
            return (pt, cfg)

    return None


# ── Unified Chat Completions ─────────────────────────────


async def chat_completion(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 4096,
    json_mode: bool = False,
    image_paths: list[str] | None = None,
) -> str:
    """
    Send a chat completion request to the active provider.
    Optionally include images for vision-capable models.
    Returns the raw response text content.
    Raises RuntimeError if no provider is available.
    """
    result = get_active_chat_provider()
    if result is None:
        logger.warning("no_chat_provider_available")
        return "[]"

    provider_type, config = result

    logger.info(
        "chat_completion_request",
        provider=provider_type.value,
        model=config.chat_model,
    )

    if provider_type == ProviderType.GOOGLE_GEMINI:
        return await _gemini_chat(
            config, system_prompt, user_prompt, temperature, max_tokens
        )
    else:
        # OpenAI-compatible providers: OpenAI, Mistral, Copilot, LM Studio, Ollama
        return await _openai_compatible_chat(
            provider_type,
            config,
            system_prompt,
            user_prompt,
            temperature,
            max_tokens,
            json_mode,
            image_paths=image_paths,
        )


async def _openai_compatible_chat(
    provider_type: ProviderType,
    config: ProviderConfig,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    json_mode: bool,
    image_paths: list[str] | None = None,
) -> str:
    """Chat completion for OpenAI-compatible APIs (OpenAI, Copilot, LM Studio, Ollama, Mistral)."""

    # Determine auth header and URL
    if provider_type == ProviderType.GITHUB_COPILOT:
        api_token = await _ensure_copilot_token(config)
        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "Editor-Version": "vscode/1.99.0",
            "Editor-Plugin-Version": "copilot-chat/0.26.0",
            "Copilot-Integration-Id": "vscode-chat",
        }
        api_url = f"{config.base_url}/chat/completions"
    elif provider_type in (ProviderType.LM_STUDIO, ProviderType.OLLAMA):
        headers = {"Content-Type": "application/json"}
        api_url = f"{config.base_url}/chat/completions"
    else:
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }
        api_url = f"{config.base_url}/chat/completions"

    # Build user message content — multimodal if images provided
    user_content: str | list[dict[str, Any]]
    if image_paths:
        content_parts: list[dict[str, Any]] = [{"type": "text", "text": user_prompt}]
        _MIME_MAP = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".bmp": "image/bmp",
            ".tiff": "image/tiff",
            ".tif": "image/tiff",
        }
        for img_path in image_paths:
            p = Path(img_path)
            if not p.is_file():
                continue
            suffix = p.suffix.lower()
            mime = _MIME_MAP.get(suffix, "image/png")
            img_b64 = base64.b64encode(p.read_bytes()).decode("ascii")
            content_parts.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime};base64,{img_b64}",
                        "detail": "auto",
                    },
                }
            )
        user_content = content_parts
        logger.info("vision_request", image_count=len(image_paths))
    else:
        user_content = user_prompt

    payload: dict[str, Any] = {
        "model": config.chat_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    # JSON mode for providers that support it
    if json_mode and provider_type in (
        ProviderType.OPENAI,
        ProviderType.GITHUB_COPILOT,
    ):
        payload["response_format"] = {"type": "json_object"}

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(api_url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        content = data["choices"][0]["message"]["content"]
        logger.info(
            "chat_completion_response",
            provider=provider_type.value,
            model=config.chat_model,
            response_length=len(content),
        )
        return content

    except httpx.HTTPStatusError as exc:
        logger.error(
            "chat_completion_http_error",
            provider=provider_type.value,
            status=exc.response.status_code,
            detail=exc.response.text[:500],
        )
        raise
    except Exception as exc:
        logger.error(
            "chat_completion_error",
            provider=provider_type.value,
            error=str(exc),
        )
        raise


async def _gemini_chat(
    config: ProviderConfig,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
) -> str:
    """Chat completion using Google Gemini's native API."""
    from app.services.google_service import google_service
    
    # Try to get OAuth credentials first
    creds = None
    try:
        # In local mode, we just take the first user's creds
        from app.core.database import async_session_factory
        from app.models.user import User
        from sqlalchemy import select
        async with async_session_factory() as session:
            res = await session.execute(select(User.id).limit(1))
            uid = res.scalar_one_or_none()
            if uid:
                creds = await google_service.get_credentials(uid)
    except Exception:
        pass

    if creds and creds.token:
        api_url = f"{config.base_url}/models/{config.chat_model}:generateContent"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {creds.token}"
        }
    else:
        api_url = (
            f"{config.base_url}/models/{config.chat_model}:generateContent"
            f"?key={config.api_key}"
        )
        headers = {"Content-Type": "application/json"}

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                api_url,
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        # Gemini response structure
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if parts:
                content = parts[0].get("text", "[]")
                logger.info(
                    "chat_completion_response",
                    provider="google_gemini",
                    model=config.chat_model,
                    response_length=len(content),
                )
                return content

        logger.warning("gemini_empty_response", data=str(data)[:500])
        return "[]"

    except httpx.HTTPStatusError as exc:
        logger.error(
            "gemini_chat_http_error",
            status=exc.response.status_code,
            detail=exc.response.text[:500],
        )
        raise
    except Exception as exc:
        logger.error("gemini_chat_error", error=str(exc))
        raise


# ── Unified Embeddings ───────────────────────────────────


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate vector embeddings using the active embedding provider.
    Falls back to pseudo-embeddings if no provider is available.
    """
    result = get_active_embedding_provider()
    if result is None:
        logger.warning(
            "no_embedding_provider", detail="using hash-based pseudo-embeddings"
        )
        return _generate_pseudo_embeddings(texts)

    provider_type, config = result

    logger.info(
        "embedding_request",
        provider=provider_type.value,
        model=config.embedding_model,
        text_count=len(texts),
    )

    try:
        if provider_type == ProviderType.GOOGLE_GEMINI:
            return await _gemini_embeddings(config, texts)
        elif provider_type == ProviderType.OLLAMA:
            return await _ollama_embeddings(config, texts)
        else:
            # OpenAI-compatible: OpenAI, Copilot, LM Studio
            return await _openai_compatible_embeddings(provider_type, config, texts)
    except Exception as exc:
        logger.error(
            "embedding_generation_failed",
            provider=provider_type.value,
            error=str(exc),
        )
        logger.warning("falling_back_to_pseudo_embeddings")
        return _generate_pseudo_embeddings(texts)


async def _openai_compatible_embeddings(
    provider_type: ProviderType,
    config: ProviderConfig,
    texts: list[str],
) -> list[list[float]]:
    """Embeddings via OpenAI-compatible API (OpenAI, Copilot, LM Studio)."""

    if provider_type == ProviderType.GITHUB_COPILOT:
        api_token = await _ensure_copilot_token(config)
        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "Editor-Version": "vscode/1.99.0",
            "Editor-Plugin-Version": "copilot-chat/0.26.0",
        }
    elif provider_type == ProviderType.LM_STUDIO:
        headers = {"Content-Type": "application/json"}
    else:
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }

    api_url = f"{config.base_url}/embeddings"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers=headers,
                json={
                    "model": config.embedding_model,
                    "input": texts,
                },
            )
            response.raise_for_status()
            data = response.json()

        embeddings: list[list[float]] = []
        for item in sorted(data["data"], key=lambda x: x["index"]):
            embeddings.append(item["embedding"])

        logger.info(
            "embeddings_generated",
            provider=provider_type.value,
            count=len(embeddings),
        )
        return embeddings

    except Exception as exc:
        logger.error(
            "openai_compatible_embedding_error",
            provider=provider_type.value,
            error=str(exc),
        )
        raise


async def _gemini_embeddings(
    config: ProviderConfig,
    texts: list[str],
) -> list[list[float]]:
    """Embeddings via Google Gemini API."""
    from app.services.google_service import google_service
    
    # Try to get OAuth credentials first
    creds = None
    try:
        from app.core.database import async_session_factory
        from app.models.user import User
        from sqlalchemy import select
        async with async_session_factory() as session:
            res = await session.execute(select(User.id).limit(1))
            uid = res.scalar_one_or_none()
            if uid:
                creds = await google_service.get_credentials(uid)
    except Exception:
        pass

    if creds and creds.token:
        api_url = f"{config.base_url}/models/{config.embedding_model}:batchEmbedContents"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {creds.token}"
        }
    else:
        api_url = (
            f"{config.base_url}/models/{config.embedding_model}:batchEmbedContents"
            f"?key={config.api_key}"
        )
        headers = {"Content-Type": "application/json"}

    requests_list = [
        {
            "model": f"models/{config.embedding_model}",
            "content": {"parts": [{"text": t}]},
            "taskType": "RETRIEVAL_DOCUMENT",
        }
        for t in texts
    ]

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers=headers,
                json={"requests": requests_list},
            )
            response.raise_for_status()
            data = response.json()

        embeddings = [item["values"] for item in data.get("embeddings", [])]
        logger.info("gemini_embeddings_generated", count=len(embeddings))
        return embeddings

    except Exception as exc:
        logger.error("gemini_embedding_error", error=str(exc))
        raise


async def _ollama_embeddings(
    config: ProviderConfig,
    texts: list[str],
) -> list[list[float]]:
    """
    Embeddings via Ollama API.
    Ollama's /api/embed endpoint supports batch input natively.
    Falls back to one-at-a-time via /v1/embeddings (OpenAI-compat).
    """
    # Try the OpenAI-compatible endpoint first (cleaner)
    try:
        return await _openai_compatible_embeddings(ProviderType.OLLAMA, config, texts)
    except Exception:
        pass

    # Fall back to native Ollama API
    base = config.base_url.replace("/v1", "")
    api_url = f"{base}/api/embed"

    try:
        embeddings: list[list[float]] = []
        async with httpx.AsyncClient(timeout=60.0) as client:
            for text in texts:
                response = await client.post(
                    api_url,
                    json={"model": config.embedding_model, "input": text},
                )
                response.raise_for_status()
                data = response.json()
                # Ollama returns {"embeddings": [[...]]}
                embs = data.get("embeddings", data.get("embedding", []))
                if isinstance(embs, list) and embs:
                    if isinstance(embs[0], list):
                        embeddings.append(embs[0])
                    else:
                        embeddings.append(embs)

        logger.info("ollama_embeddings_generated", count=len(embeddings))
        return embeddings

    except Exception as exc:
        logger.error("ollama_embedding_error", error=str(exc))
        raise


def _generate_pseudo_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Deterministic pseudo-embeddings from SHA-256 hashes.
    Used when no real embedding provider is available.
    """
    embeddings: list[list[float]] = []
    for text in texts:
        h = hashlib.sha256(text.encode("utf-8")).digest()
        values: list[float] = []
        for i in range(1536):
            byte_val = h[i % len(h)]
            values.append((byte_val / 255.0) * 2 - 1)
        embeddings.append(values)
    return embeddings


# ── Health / Status ──────────────────────────────────────


async def check_provider_health(provider_type: ProviderType) -> dict[str, Any]:
    """Check if a specific provider is reachable and functional."""
    configs = _load_all_configs()
    cfg = configs.get(provider_type.value)

    if not cfg or not cfg.enabled:
        return {"status": "disabled", "provider": provider_type.value}

    try:
        if provider_type in (ProviderType.LM_STUDIO, ProviderType.OLLAMA):
            # Check if local server is running
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{cfg.base_url}/models")
                response.raise_for_status()
                models = response.json()
                return {
                    "status": "connected",
                    "provider": provider_type.value,
                    "models": [
                        m.get("id", m.get("name", "unknown"))
                        for m in models.get("data", models.get("models", []))
                    ],
                }
        elif provider_type == ProviderType.GITHUB_COPILOT:
            # Check if we can get a copilot token
            token = await _ensure_copilot_token(cfg)
            return {
                "status": "connected",
                "provider": provider_type.value,
                "has_token": bool(token),
            }
        elif provider_type == ProviderType.GOOGLE_GEMINI:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{cfg.base_url}/models?key={cfg.api_key}")
                response.raise_for_status()
                return {"status": "connected", "provider": provider_type.value}
        else:
            return {"status": "configured", "provider": provider_type.value}

    except Exception as exc:
        return {
            "status": "error",
            "provider": provider_type.value,
            "error": str(exc),
        }


def get_provider_summary() -> dict[str, Any]:
    """Get a summary of all providers for the health endpoint."""
    configs = _load_all_configs()

    summary: dict[str, Any] = {}
    for pt in ProviderType:
        cfg = configs.get(pt.value)
        if cfg and cfg.enabled:
            summary[pt.value] = {
                "enabled": True,
                "chat_model": cfg.chat_model,
                "embedding_model": cfg.embedding_model,
                "has_api_key": bool(cfg.api_key),
            }
        else:
            # Check .env fallbacks
            if pt == ProviderType.OPENAI and settings.openai_api_key:
                summary[pt.value] = {
                    "enabled": True,
                    "chat_model": settings.openai_chat_model,
                    "embedding_model": settings.openai_embedding_model,
                    "source": "env",
                }
            elif pt == ProviderType.MISTRAL and settings.mistral_api_key:
                summary[pt.value] = {
                    "enabled": True,
                    "chat_model": "mistral-large-latest",
                    "source": "env",
                }
            else:
                summary[pt.value] = {"enabled": False}

    # Active provider info
    chat_provider = get_active_chat_provider()
    embed_provider = get_active_embedding_provider()

    summary["_active_chat"] = chat_provider[0].value if chat_provider else None
    summary["_active_embedding"] = embed_provider[0].value if embed_provider else None

    return summary
