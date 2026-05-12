"""
Custom LiteLLM callback that emits a structured JSON line to stdout
for every completed LLM request. CloudWatch metric filters parse these
lines to populate the DocumentProcessing/LlmGateway namespace.
"""

import json
import logging
import sys
import time
import traceback
from datetime import datetime, timezone

from litellm.integrations.custom_logger import CustomLogger

log = logging.getLogger("metrics_logger")


class MetricsLogger(CustomLogger):

    def _build_success_record(self, kwargs, response_obj, start_time, end_time):
        usage = getattr(response_obj, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
        completion_tokens = getattr(usage, "completion_tokens", 0) if usage else 0
        total_tokens = getattr(usage, "total_tokens", 0) if usage else 0

        model = kwargs.get("model", "unknown")
        litellm_params = kwargs.get("litellm_params", {}) or {}
        model_alias = (
            litellm_params.get("model_alias")
            or kwargs.get("model_info", {}).get("model_name")
            or model
        )

        response_cost = kwargs.get("response_cost", 0) or 0

        start_ts = (
            start_time.timestamp()
            if isinstance(start_time, datetime)
            else float(start_time)
        )
        end_ts = (
            end_time.timestamp()
            if isinstance(end_time, datetime)
            else float(end_time)
        )
        response_time_ms = round((end_ts - start_ts) * 1000)

        # Extract customer/user identity from LiteLLM kwargs
        metadata = kwargs.get("metadata") or {}
        litellm_meta = (kwargs.get("litellm_params") or {}).get("metadata") or {}
        end_user = kwargs.get("end_user") or kwargs.get("user") or ""
        customer_name = (
            metadata.get("customer_name")
            or litellm_meta.get("user_api_key_user_id")
            or ""
        )

        return {
            "litellm_metric": True,
            "model": model_alias,
            "provider_model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "response_cost": response_cost,
            "response_time_ms": response_time_ms,
            "status_code": 200,
            "end_user_id": end_user,
            "customer_name": customer_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _build_failure_record(self, kwargs, response_obj, start_time, end_time):
        model = kwargs.get("model", "unknown")
        litellm_params = kwargs.get("litellm_params", {}) or {}
        model_alias = (
            litellm_params.get("model_alias")
            or kwargs.get("model_info", {}).get("model_name")
            or model
        )

        start_ts = (
            start_time.timestamp()
            if isinstance(start_time, datetime)
            else float(start_time)
        )
        end_ts = (
            end_time.timestamp()
            if isinstance(end_time, datetime)
            else float(end_time)
        )
        response_time_ms = round((end_ts - start_ts) * 1000)

        exception = kwargs.get("exception", "")
        status_code = getattr(exception, "status_code", 500) if exception else 500

        # Extract customer/user identity from LiteLLM kwargs
        metadata = kwargs.get("metadata") or {}
        litellm_meta = (kwargs.get("litellm_params") or {}).get("metadata") or {}
        end_user = kwargs.get("end_user") or kwargs.get("user") or ""
        customer_name = (
            metadata.get("customer_name")
            or litellm_meta.get("user_api_key_user_id")
            or ""
        )

        return {
            "litellm_metric": True,
            "model": model_alias,
            "provider_model": model,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "response_cost": 0,
            "response_time_ms": response_time_ms,
            "status_code": status_code,
            "error": str(exception)[:200] if exception else "unknown",
            "end_user_id": end_user,
            "customer_name": customer_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _emit(self, record):
        line = json.dumps(record)
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

    # Sync callbacks (used by non-proxy litellm calls)
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._emit(self._build_success_record(kwargs, response_obj, start_time, end_time))
        except Exception as e:
            log.error("MetricsLogger.log_success_event failed: %s\n%s", e, traceback.format_exc())

    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._emit(self._build_failure_record(kwargs, response_obj, start_time, end_time))
        except Exception as e:
            log.error("MetricsLogger.log_failure_event failed: %s\n%s", e, traceback.format_exc())

    # Async callbacks (used by the LiteLLM proxy)
    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._emit(self._build_success_record(kwargs, response_obj, start_time, end_time))
        except Exception as e:
            log.error("MetricsLogger.async_log_success_event failed: %s\n%s", e, traceback.format_exc())

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._emit(self._build_failure_record(kwargs, response_obj, start_time, end_time))
        except Exception as e:
            log.error("MetricsLogger.async_log_failure_event failed: %s\n%s", e, traceback.format_exc())

metrics_logger_instance = MetricsLogger()
