# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 VKU.VIC
"""Best-effort token metering to IAM usage analytics (#26).

The inference service is the only component that sees prompt/completion token
counts, so it reports them directly to IAM `/v1/usage/ingest` using the shared
internal secret. Failures never affect the inference response.
"""

from __future__ import annotations

import time

import httpx

from .config import settings

_INGEST_PATH = "/v1/usage/ingest"


def _tenant_headers(request) -> dict[str, str]:
    out: dict[str, str] = {}
    for src, dst in (
        ("x-synapseone-org", "x-synapseone-org"),
        ("x-synapseone-account", "x-synapseone-account"),
        ("x-synapseone-user", "x-synapseone-user"),
        ("x-request-id", "x-request-id"),
    ):
        value = request.headers.get(src)
        if value:
            out[dst] = value
    if settings.SYNAPSEONE_INTERNAL_SECRET:
        out["x-synapseone-internal"] = settings.SYNAPSEONE_INTERNAL_SECRET
    return out


async def report_usage(
    request,
    *,
    path: str,
    status_code: int,
    duration_ms: int,
    model: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int | None = None,
    error: str | None = None,
) -> None:
    """Send one usage event to IAM. Never raises."""
    if not settings.USAGE_REPORTING:
        return
    total = (
        total_tokens if total_tokens is not None else prompt_tokens + completion_tokens
    )
    event = {
        "feature": "inference",
        "route": "/v1/inference",
        "method": "POST",
        "path": path,
        "status": status_code,
        "durationMs": max(0, min(int(duration_ms), 3_600_000)),
        "authKind": "user" if request.headers.get("x-synapseone-user") else "unknown",
        "orgId": request.headers.get("x-synapseone-org") or None,
        "accountId": request.headers.get("x-synapseone-account") or None,
        "userId": request.headers.get("x-synapseone-user") or None,
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "totalTokens": total,
        "model": model,
        "error": error,
    }
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(
                settings.IAM_SERVICE_URL + _INGEST_PATH,
                json={"events": [event]},
                headers=_tenant_headers(request),
            )
    except Exception:
        # Best-effort: metering must never break inference.
        return


class Timer:
    def __init__(self) -> None:
        self.started = time.monotonic()

    def ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)
