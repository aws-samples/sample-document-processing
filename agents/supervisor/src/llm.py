"""Shared LLM model configuration pointing at the LiteLLM Gateway."""

import contextvars
import logging
import os
from pathlib import Path

import boto3
from dotenv import load_dotenv
from strands.models.openai import OpenAIModel

# Load .env from the supervisor project root for local development.
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")

log = logging.getLogger(__name__)

# Gateway URL — internal ALB (agents run in VPC, no need for CloudFront hop)
GATEWAY_URL = os.environ.get("LLM_GATEWAY_URL", "")
if not GATEWAY_URL:
    raise ValueError("LLM_GATEWAY_URL environment variable is required")

_SECRET_ARN = os.environ.get(
    "LLM_GATEWAY_API_KEY_SECRET_ARN",
    "",
)

# Per-request context (set by supervisor handler before invoking pipeline)
current_customer: contextvars.ContextVar[str] = contextvars.ContextVar("customer_name")
current_user: contextvars.ContextVar[str] = contextvars.ContextVar("user_name")

_api_key_cache: str | None = None


def _get_api_key() -> str:
    """Retrieve the gateway API key from Secrets Manager (cached after first call)."""
    global _api_key_cache
    if _api_key_cache is not None:
        return _api_key_cache

    # Allow env var override for local dev / testing
    env_key = os.environ.get("LLM_GATEWAY_API_KEY")
    if env_key:
        _api_key_cache = env_key
        return _api_key_cache

    if not _SECRET_ARN:
        raise ValueError(
            "LLM_GATEWAY_API_KEY_SECRET_ARN environment variable is required "
            "when LLM_GATEWAY_API_KEY is not set"
        )

    try:
        sm = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        resp = sm.get_secret_value(SecretId=_SECRET_ARN)
        _api_key_cache = resp["SecretString"]
        log.debug("Loaded LLM Gateway API key from Secrets Manager")
    except Exception as e:
        log.error("Failed to retrieve API key from Secrets Manager")
        raise

    return _api_key_cache


def get_model(model_id: str) -> OpenAIModel:
    """Create an OpenAIModel with customer/user tracking headers.

    Reads customerName/userName from contextvars (set by supervisor handler).
    Uses the shared admin API key for all requests. Customer and user identity
    is passed via LiteLLM headers for spend tracking.

    Args:
        model_id: Gateway model alias — "claude-primary" (Sonnet) or "claude-fast" (Haiku).
    """
    customer = current_customer.get(None)
    user = current_user.get(None)

    client_args: dict = {
        "base_url": f"{GATEWAY_URL}/v1",
        "api_key": _get_api_key(),
        "max_retries": 8,
        "timeout": 3600.0,
    }

    headers = {}
    if customer:
        headers["x-litellm-customer-id"] = customer
    if user:
        headers["x-litellm-end-user-id"] = user
    if headers:
        client_args["default_headers"] = headers

    return OpenAIModel(client_args=client_args, model_id=model_id)
