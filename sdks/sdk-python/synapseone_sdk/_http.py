# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 VKU.VIC
# Copyright 2026 SynapseOne Contributors
# Licensed under the Apache License, Version 2.0 (the "License");
"""Shared HTTP plumbing for the synapseone SDK.

Every service module (iam, workflow, lds, base, faststore, queue) talks to the
platform through one :class:`HttpClient`, which adds auth headers, the optional
platform tenant header and maps every failure (network or HTTP) to
:class:`SynapseOneError`.
"""

from __future__ import annotations

import json
import time
from typing import Any, Iterable, Iterator

import requests

# Sentinel for "argument was not provided", distinct from None (an explicit
# null must be distinguishable from "leave untouched" in partial updates).
UNSET = object()

DEFAULT_BASE_URL = "https://api.synapseone.space"
DEFAULT_TIMEOUT = 15
INFERENCE_TIMEOUT = 120
WEBHOOK_TIMEOUT = 300
_RETRYABLE = {429, 502, 503, 504}


class SynapseOneError(Exception):
    """All SDK errors surface as SynapseOneError (network or HTTP).

    ``status`` carries the HTTP status code when the failure came from a JSON
    response (None for network errors) and ``body`` carries the parsed error
    body when one was returned, so callers can branch on codes such as
    ``not_found`` or ``version_conflict``.
    """

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        body: Any | None = None,
        code: str | None = None,
        base_url: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.code = code
        self.base_url = base_url


class HttpClient:
    """Thin request layer shared by all SynapseOne services.

    ``base_url`` points at the gateway (defaults to
    ``https://api.synapseone.space`` or ``SYNAPSEONE_BASE_URL``) or directly at
    a service origin. ``tenant`` is only needed by platform callers of the
    tenant-scoped services (faststore/queue) and is sent as
    ``x-synapseone-tenant``.
    """

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        api_key: str | None = None,
        tenant: str | None = None,
        timeout: int = DEFAULT_TIMEOUT,
        max_attempts: int = 3,
        retry_base: float = 0.2,
    ) -> None:
        import os

        url = (
            base_url
            or os.environ.get("SYNAPSEONE_BASE_URL")
            or os.environ.get("SYNAPSEDX_BASE_URL")
            or DEFAULT_BASE_URL
        )
        self.base_url = url.rstrip("/")
        self.token = token
        self.api_key = api_key
        self.tenant = tenant
        self.timeout = timeout
        self.max_attempts = max(1, int(max_attempts))
        self.retry_base = max(0.0, float(retry_base))

    def headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if self.api_key:
            h["X-API-Key"] = self.api_key
        if self.tenant:
            h["x-synapseone-tenant"] = self.tenant
        if extra:
            h.update(extra)
        return h

    # Convenience verbs (used by namespaced services).
    def get(self, path: str, **kw: Any) -> Any:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any | None = None, **kw: Any) -> Any:
        return self.request("POST", path, body, **kw)

    def put(self, path: str, body: Any | None = None, **kw: Any) -> Any:
        return self.request("PUT", path, body, **kw)

    def delete(self, path: str, body: Any | None = None, **kw: Any) -> Any:
        return self.request("DELETE", path, body, **kw)

    def _retry_after(self, value: str | None) -> float | None:
        if not value:
            return None
        try:
            return min(max(float(value), 0.0), 30.0)
        except (TypeError, ValueError):
            return None

    def _raise_html(self, path: str, status: int, text: str) -> None:
        head = text[:256].lstrip().lower()
        if head.startswith("<!doctype html") or head.startswith("<html"):
            raise SynapseOneError(
                f"synapseone expected JSON from {self.base_url}{path} but received HTML "
                f"(status {status}). The base URL looks like the console/marketing host; "
                f"use {DEFAULT_BASE_URL}.",
                status=status,
                code="non_json_response",
                base_url=self.base_url,
            )

    def request(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        *,
        timeout: int | None = None,
        headers: dict[str, str] | None = None,
        max_attempts: int | None = None,
        retryable: bool | None = None,
    ) -> Any:
        method = (method or "GET").upper()
        url = self.base_url + path
        to = timeout or self.timeout
        attempts = max(1, int(max_attempts or self.max_attempts))
        if retryable is None:
            retryable = method in {"GET", "HEAD", "OPTIONS", "PUT", "DELETE"}
        last: SynapseOneError | None = None
        for attempt in range(1, attempts + 1):
            try:
                r = requests.request(
                    method,
                    url,
                    json=body,
                    headers=self.headers(headers),
                    timeout=to,
                )
            except Exception as e:  # network, DNS, timeout...
                last = SynapseOneError(
                    f"synapseone network {path}: {e} (base {self.base_url})",
                    code="network_error",
                    base_url=self.base_url,
                )
                if retryable and attempt < attempts:
                    time.sleep(self.retry_base * (2 ** (attempt - 1)))
                    continue
                raise last from e
            if r.status_code >= 400:
                body_json = _try_json(r)
                err = SynapseOneError(
                    f"synapseone {r.status_code} {path}: {r.text[:500]} (base {self.base_url})",
                    status=r.status_code,
                    body=body_json,
                    code=(body_json or {}).get("error")
                    if isinstance(body_json, dict)
                    else None,
                    base_url=self.base_url,
                )
                if retryable and r.status_code in _RETRYABLE and attempt < attempts:
                    wait = self._retry_after(r.headers.get("Retry-After"))
                    if wait is None:
                        wait = self.retry_base * (2 ** (attempt - 1))
                    time.sleep(wait)
                    last = err
                    continue
                raise err
            if not r.text:
                return None
            self._raise_html(path, r.status_code, r.text)
            try:
                return r.json()
            except ValueError:
                return r.text  # non-JSON body (text/plain endpoints)

        raise last or SynapseOneError(
            f"synapseone {path}: retries exhausted", base_url=self.base_url
        )

    def request_binary(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        *,
        timeout: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> bytes:
        """Fetch a raw binary body (object downloads, attachments)."""
        url = self.base_url + path
        r = requests.request(
            (method or "GET").upper(),
            url,
            data=body,
            headers=self.headers(headers),
            timeout=timeout or self.timeout,
        )
        if r.status_code >= 400:
            raise SynapseOneError(
                f"synapseone {r.status_code} {path}: {r.text[:500]} (base {self.base_url})",
                status=r.status_code,
                body=_try_json(r),
                base_url=self.base_url,
            )
        return r.content

    def upload(
        self,
        method: str,
        path: str,
        body: bytes,
        *,
        content_type: str = "application/octet-stream",
        timeout: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        """Send a raw binary body and parse the JSON response."""
        r = requests.request(
            (method or "PUT").upper(),
            self.base_url + path,
            data=body,
            headers=self.headers({"Content-Type": content_type, **(headers or {})}),
            timeout=timeout or self.timeout,
        )
        if r.status_code >= 400:
            raise SynapseOneError(
                f"synapseone {r.status_code} {path}: {r.text[:500]} (base {self.base_url})",
                status=r.status_code,
                body=_try_json(r),
                base_url=self.base_url,
            )
        if not r.text:
            return None
        try:
            return r.json()
        except ValueError:
            return r.text

    def head(self, path: str, *, timeout: int | None = None) -> dict[str, str]:
        """HEAD request; returns lower-cased response headers."""
        r = requests.request(
            "HEAD",
            self.base_url + path,
            headers=self.headers(),
            timeout=timeout or self.timeout,
        )
        if r.status_code >= 400:
            raise SynapseOneError(
                f"synapseone {r.status_code} {path} (base {self.base_url})",
                status=r.status_code,
                base_url=self.base_url,
            )
        return {k.lower(): v for k, v in r.headers.items()}

    def stream(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        *,
        timeout: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> Iterator[tuple[str, str]]:
        """Yield ``(event, data)`` Server-Sent-Events records without buffering.

        The HTTP response is closed when the generator is exhausted or garbage
        collected; callers can stop early and the ``finally`` block closes it.
        """
        url = self.base_url + path
        r = requests.request(
            (method or "GET").upper(),
            url,
            json=body,
            headers=self.headers(headers),
            timeout=timeout or INFERENCE_TIMEOUT,
            stream=True,
        )
        if r.status_code >= 400:
            try:
                text = r.text
            finally:
                r.close()
            raise SynapseOneError(
                f"synapseone {r.status_code} {path}: {text[:500]} (base {self.base_url})",
                status=r.status_code,
                body=_try_json_text(text),
                base_url=self.base_url,
            )
        try:
            event = "message"
            data: list[str] = []
            for raw in r.iter_lines(decode_unicode=True):
                line = (raw or "").rstrip("\r")
                if not line:
                    if data:
                        yield event, "\n".join(data)
                    event, data = "message", []
                    continue
                if line.startswith(":"):
                    continue
                field, _, value = line.partition(":")
                value = value[1:] if value.startswith(" ") else value
                if field == "event":
                    event = value
                elif field == "data":
                    data.append(value)
            if data:
                yield event, "\n".join(data)
        finally:
            r.close()


def parse_chat_delta(data: str) -> str | None:
    """Extract incremental text from one SSE ``data:`` payload."""
    if not data or data == "[DONE]":
        return None
    try:
        j = json.loads(data)
    except ValueError:
        return data
    try:
        choice = (j.get("choices") or [{}])[0]
        delta = (choice.get("delta") or {}).get("content") or (
            choice.get("message") or {}
        ).get("content")
    except AttributeError:
        delta = None
    if isinstance(delta, str) and delta:
        return delta
    content = j.get("content") if isinstance(j, dict) else None
    return content if isinstance(content, str) and content else None


def _try_json(r: Any) -> Any:
    try:
        return r.json()
    except ValueError:
        return None


def _try_json_text(text: str) -> Any:
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


def iter_text(events: Iterable[tuple[str, str]]) -> Iterator[str]:
    """Project an SSE generator to incremental assistant text chunks."""
    for _event, data in events:
        chunk = parse_chat_delta(data)
        if chunk:
            yield chunk
