# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 VKU.VIC
# Copyright 2026 SynapseOne Contributors
# Licensed under the Apache License, Version 2.0 (the "License");
"""Typed gateway health/readiness contract (issue #42)."""

from __future__ import annotations

from typing import Any

from ._http import HttpClient, SynapseOneError


class HealthService:
    """Namespace for the gateway health/readiness contract."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def health(self) -> dict[str, Any]:
        """Shallow gateway health (never raises for a degraded upstream)."""
        return self._http.get("/health", max_attempts=1)

    def ready(self, *, throw_on_degraded: bool = False) -> dict[str, Any]:
        """Aggregate readiness.

        A 503 means "degraded", not "unreachable": by default the parsed payload
        is returned so callers can project the upstream list. Pass
        ``throw_on_degraded=True`` for strict probe semantics.
        """
        try:
            return self._http.get("/ready", max_attempts=1)
        except SynapseOneError as e:
            if e.status == 503 and isinstance(e.body, dict) and not throw_on_degraded:
                return e.body
            raise

    def status(self) -> dict[str, Any]:
        """Project ``{ok, tier1, upstreams}`` for Tier-2 readiness endpoints."""
        try:
            health = self.health()
            reachable = bool(health.get("status"))
        except SynapseOneError as e:
            health = {}
            reachable = False
        try:
            ready = self.ready()
        except SynapseOneError:
            ready = {}
        upstreams = ready.get("upstreams") if isinstance(ready, dict) else []
        return {
            "ok": reachable and isinstance(ready, dict) and ready.get("status") == "ready",
            "tier1": {
                "status": health.get("status", "unreachable"),
                "version": health.get("version"),
                "reachable": reachable,
            },
            "upstreams": upstreams or [],
            "time": ready.get("time") if isinstance(ready, dict) else None,
        }
