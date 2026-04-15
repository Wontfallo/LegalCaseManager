"""
Provider Management API – Configure LLM providers.

Endpoints:
  GET  /api/providers/          – List all providers and their status
  POST /api/providers/configure – Save/update a provider configuration
  GET  /api/providers/health/{provider} – Check a specific provider's health

  -- GitHub Copilot OAuth Device Flow --
  POST /api/providers/github-copilot/connect  – Start device flow
  GET  /api/providers/github-copilot/poll      – Poll for authorization
  GET  /api/providers/github-copilot/status    – Check current auth status
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.services.llm_provider import (
    ProviderConfig,
    ProviderType,
    PROVIDER_DEFAULTS,
    check_provider_health,
    get_all_provider_configs,
    get_copilot_available_models,
    get_provider_config,
    get_provider_summary,
    poll_github_device_flow,
    save_provider_config_public,
    start_github_device_flow,
)

logger = get_logger("providers_router")

router = APIRouter(prefix="/api/providers", tags=["Providers"])


# ── Schemas ──────────────────────────────────────────────


class ProviderConfigRequest(BaseModel):
    """Request body for configuring a provider."""

    provider: str = Field(
        ...,
        description="Provider type: github_copilot, google_gemini, lm_studio, ollama, openai, mistral",
    )
    enabled: bool = True
    api_key: str = Field(
        default="", description="API key (not needed for local providers)"
    )
    base_url: str = Field(default="", description="Override base URL (optional)")
    chat_model: str = Field(default="", description="Chat model ID")
    embedding_model: str = Field(default="", description="Embedding model ID")


class ProviderConfigResponse(BaseModel):
    """Response showing a provider's configuration (API key masked)."""

    provider: str
    enabled: bool
    has_api_key: bool
    base_url: str
    chat_model: str
    embedding_model: str


class DeviceFlowResponse(BaseModel):
    """Response from GitHub device flow initiation."""

    user_code: str
    verification_uri: str
    expires_in: int


# ── Endpoints ────────────────────────────────────────────


@router.get("/")
async def list_providers() -> dict[str, Any]:
    """List all providers with their status and active provider info."""
    return get_provider_summary()


@router.post("/configure")
async def configure_provider(body: ProviderConfigRequest) -> dict[str, str]:
    """Configure or update an LLM provider."""
    try:
        provider_type = ProviderType(body.provider)
    except ValueError:
        valid = [p.value for p in ProviderType]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid provider: {body.provider}. Valid: {valid}",
        )

    existing = get_all_provider_configs().get(provider_type.value)

    # Merge with defaults
    defaults = PROVIDER_DEFAULTS.get(provider_type, {})
    base_url = body.base_url or (
        existing.base_url
        if existing and existing.base_url
        else defaults.get("base_url", "")
    )
    chat_model = body.chat_model or (
        existing.chat_model
        if existing and existing.chat_model
        else defaults.get("chat_model", "")
    )
    embedding_model = body.embedding_model or (
        existing.embedding_model
        if existing and existing.embedding_model
        else defaults.get("embedding_model", "")
    )
    api_key = body.api_key or (existing.api_key if existing else "")
    extra = existing.extra.copy() if existing else {}

    config = ProviderConfig(
        provider_type=provider_type,
        enabled=body.enabled,
        api_key=api_key,
        base_url=base_url,
        chat_model=chat_model,
        embedding_model=embedding_model,
        extra=extra,
    )

    save_provider_config_public(config)

    logger.info(
        "provider_configured", provider=provider_type.value, enabled=body.enabled
    )
    return {
        "message": f"Provider '{provider_type.value}' configured successfully.",
        "provider": provider_type.value,
        "enabled": str(body.enabled),
    }


@router.get("/health/{provider}")
async def provider_health(provider: str) -> dict[str, Any]:
    """Check the health/connectivity of a specific provider."""
    try:
        provider_type = ProviderType(provider)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid provider: {provider}",
        )

    return await check_provider_health(provider_type)


@router.get("/defaults/{provider}")
async def get_provider_defaults(provider: str) -> dict[str, str]:
    """Get default configuration values for a provider."""
    try:
        provider_type = ProviderType(provider)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid provider: {provider}",
        )

    defaults = PROVIDER_DEFAULTS.get(provider_type, {})
    return {
        "provider": provider_type.value,
        **defaults,
    }


# ── GitHub Copilot OAuth Device Flow ─────────────────────


@router.post("/github-copilot/connect")
async def github_copilot_connect() -> dict[str, Any]:
    """
    Start the GitHub OAuth device flow.
    Returns a user_code and verification_uri.
    The user navigates to the URI, enters the code, and authorizes.
    Then poll the /poll endpoint until complete.
    """
    try:
        result = await start_github_device_flow()
        return result
    except Exception as exc:
        logger.error("github_device_flow_start_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to start GitHub device flow: {exc}",
        )


@router.get("/github-copilot/poll")
async def github_copilot_poll() -> dict[str, Any]:
    """
    Poll the GitHub device flow to check if the user has authorized.
    Call this every few seconds after /connect until status is 'complete' or 'error'.
    """
    try:
        result = await poll_github_device_flow()
        return result
    except Exception as exc:
        logger.error("github_device_flow_poll_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Device flow poll failed: {exc}",
        )


@router.get("/github-copilot/status")
async def github_copilot_status() -> dict[str, Any]:
    """Check if GitHub Copilot is currently authenticated."""
    cfg = get_provider_config(ProviderType.GITHUB_COPILOT)
    if cfg and cfg.api_key:
        return {
            "authenticated": True,
            "chat_model": cfg.chat_model,
            "embedding_model": cfg.embedding_model,
        }
    return {"authenticated": False}


@router.get("/github-copilot/models")
async def github_copilot_models() -> dict[str, Any]:
    """Fetch the list of models available through GitHub Copilot."""
    try:
        models = await get_copilot_available_models()
        return {"models": models}
    except Exception as exc:
        logger.error("copilot_models_fetch_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Copilot models: {exc}",
        )


# ── Google Gemini ────────────────────────────────────────


@router.post("/google-gemini/configure")
async def configure_gemini(
    api_key: str = "",
    chat_model: str = "",
    embedding_model: str = "",
) -> dict[str, str]:
    """
    Quick configure for Google Gemini.
    Just needs an API key from https://aistudio.google.com/apikey
    """
    defaults = PROVIDER_DEFAULTS[ProviderType.GOOGLE_GEMINI]
    config = ProviderConfig(
        provider_type=ProviderType.GOOGLE_GEMINI,
        enabled=True,
        api_key=api_key,
        base_url=defaults["base_url"],
        chat_model=chat_model or defaults["chat_model"],
        embedding_model=embedding_model or defaults["embedding_model"],
    )
    save_provider_config_public(config)
    return {
        "message": "Google Gemini configured successfully.",
        "chat_model": config.chat_model,
    }


# ── Local Providers (LM Studio / Ollama) ─────────────────


@router.post("/local/auto-detect")
async def auto_detect_local_providers() -> dict[str, Any]:
    """
    Check if LM Studio or Ollama is running locally and auto-configure.
    """
    results: dict[str, Any] = {}

    for provider_type, default_url in [
        (ProviderType.LM_STUDIO, PROVIDER_DEFAULTS[ProviderType.LM_STUDIO]["base_url"]),
        (ProviderType.OLLAMA, PROVIDER_DEFAULTS[ProviderType.OLLAMA]["base_url"]),
    ]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{default_url}/models")
                if response.status_code == 200:
                    data = response.json()
                    models = data.get("data", data.get("models", []))
                    model_ids = [m.get("id", m.get("name", "unknown")) for m in models]

                    # Auto-configure with the first available model
                    chat_model = model_ids[0] if model_ids else ""
                    embedding_model = ""

                    # For Ollama, try to find an embedding model
                    if provider_type == ProviderType.OLLAMA:
                        embed_candidates = [
                            m
                            for m in model_ids
                            if "embed" in m.lower() or "nomic" in m.lower()
                        ]
                        if embed_candidates:
                            embedding_model = embed_candidates[0]

                    config = ProviderConfig(
                        provider_type=provider_type,
                        enabled=True,
                        base_url=default_url,
                        chat_model=chat_model,
                        embedding_model=embedding_model,
                    )
                    save_provider_config_public(config)

                    results[provider_type.value] = {
                        "detected": True,
                        "models": model_ids,
                        "chat_model": chat_model,
                        "embedding_model": embedding_model,
                    }
                else:
                    results[provider_type.value] = {"detected": False}
        except Exception:
            results[provider_type.value] = {"detected": False}

    return results
