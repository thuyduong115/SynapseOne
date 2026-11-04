# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 VKU.VIC
# Copyright 2026 SynapseOne Contributors
# Licensed under the Apache License, Version 2.0 (the "License");
"""SynapseNotifications client: outbox, templates and preferences (#25)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ._http import HttpClient

_PREFIX = "/v1/notifications"


class NotificationsService:
    """Namespace for SynapseNotifications operations."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def send(
        self,
        recipient: dict[str, Any],
        body: str,
        channel: str | None = None,
        channels: list[str] | None = None,
        subject: str = "",
        data: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        """Queue a notification (one record per channel)."""
        payload: dict[str, Any] = {
            "recipient": recipient,
            "body": body,
            "subject": subject,
        }
        if channel:
            payload["channel"] = channel
        if channels:
            payload["channels"] = channels
        if data is not None:
            payload["data"] = data
        if idempotency_key:
            payload["idempotencyKey"] = idempotency_key
        return self._http.request("POST", _PREFIX, payload)

    def get(self, notification_id: str) -> dict:
        return self._http.request("GET", f"{_PREFIX}/{quote(notification_id, safe='')}")

    def list(self, status: str | None = None, limit: int = 50) -> list:
        params = [f"limit={int(limit)}"]
        if status:
            params.append("status=" + quote(status, safe=""))
        return self._http.request("GET", f"{_PREFIX}?{'&'.join(params)}")

    def cancel(self, notification_id: str) -> dict:
        return self._http.request(
            "POST", f"{_PREFIX}/{quote(notification_id, safe='')}/cancel", {}
        )

    def get_preference(self, recipient: str) -> dict:
        return self._http.request(
            "GET", f"{_PREFIX}/preferences/{quote(recipient, safe='')}"
        )

    def set_preference(
        self,
        recipient: str,
        channels: list[str] | None = None,
        unsubscribed: bool | None = None,
    ) -> dict:
        payload: dict[str, Any] = {}
        if channels is not None:
            payload["channels"] = channels
        if unsubscribed is not None:
            payload["unsubscribed"] = unsubscribed
        return self._http.request(
            "PUT", f"{_PREFIX}/preferences/{quote(recipient, safe='')}", payload
        )

    def unsubscribe(self, recipient: str) -> dict:
        return self._http.request(
            "POST", f"{_PREFIX}/unsubscribe", {"recipient": recipient}
        )
