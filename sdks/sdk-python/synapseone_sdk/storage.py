# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 VKU.VIC
# Copyright 2026 SynapseOne Contributors
# Licensed under the Apache License, Version 2.0 (the "License");
"""SynapseObjectStorage client: tenant-scoped object/file storage (#24)."""

from __future__ import annotations

from urllib.parse import quote

from ._http import HttpClient, SynapseOneError

_PREFIX = "/v1/storage"


def _key_path(key: str) -> str:
    return "/".join(quote(seg, safe="") for seg in str(key).split("/"))


class StorageService:
    """Namespace for SynapseObjectStorage operations."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def put_object(
        self,
        key: str,
        body: bytes,
        content_type: str = "application/octet-stream",
        checksum_sha256: str | None = None,
    ) -> dict:
        """Upload raw bytes (upsert). Optionally provide a hex sha256 checksum."""
        headers = {}
        if checksum_sha256:
            headers["x-object-checksum-sha256"] = checksum_sha256
        return self._http.upload(
            "PUT",
            f"{_PREFIX}/objects/{_key_path(key)}",
            body,
            content_type=content_type,
            headers=headers,
        )

    def get_object(self, key: str) -> bytes:
        """Download an object as bytes."""
        return self._http.request_binary("GET", f"{_PREFIX}/objects/{_key_path(key)}")

    def head_object(self, key: str) -> dict | None:
        """HEAD metadata; returns None when the object does not exist."""
        try:
            h = self._http.head(f"{_PREFIX}/objects/{_key_path(key)}")
        except SynapseOneError as e:
            if e.status == 404:
                return None
            raise
        return {
            "key": h.get("x-object-key", key),
            "size": int(h.get("content-length") or 0),
            "contentType": h.get("content-type", "application/octet-stream"),
            "etag": (h.get("etag") or "").strip('"'),
            "checksumSha256": h.get("x-object-checksum-sha256"),
            "createdAt": h.get("x-object-created-at", ""),
            "updatedAt": h.get("x-object-updated-at", ""),
        }

    def delete_object(self, key: str) -> dict:
        return self._http.request("DELETE", f"{_PREFIX}/objects/{_key_path(key)}")

    def list_objects(
        self, prefix: str = "", limit: int = 100, cursor: str | None = None
    ) -> dict:
        params = [f"limit={int(limit)}"]
        if prefix:
            params.append("prefix=" + quote(prefix, safe=""))
        if cursor:
            params.append("cursor=" + quote(cursor, safe=""))
        return self._http.request("GET", f"{_PREFIX}/objects?{'&'.join(params)}")

    def presign(
        self,
        key: str,
        method: str = "GET",
        expires_in: int = 900,
    ) -> dict:
        """Presigned URL (S3 backend only)."""
        return self._http.request(
            "POST",
            f"{_PREFIX}/presign",
            {"key": key, "method": method, "expiresIn": expires_in},
        )

    def create_multipart(
        self, key: str, content_type: str = "application/octet-stream"
    ) -> dict:
        return self._http.request(
            "POST", f"{_PREFIX}/uploads", {"key": key, "contentType": content_type}
        )

    def upload_part(
        self, upload_id: str, key: str, part_number: int, body: bytes
    ) -> dict:
        return self._http.upload(
            "PUT",
            f"{_PREFIX}/uploads/{quote(upload_id, safe='')}/parts/{int(part_number)}"
            f"?key={quote(key, safe='')}",
            body,
            content_type="application/octet-stream",
        )

    def complete_multipart(self, upload_id: str, key: str, parts: list[dict]) -> dict:
        return self._http.request(
            "POST",
            f"{_PREFIX}/uploads/{quote(upload_id, safe='')}/complete",
            {"key": key, "parts": parts},
        )

    def abort_multipart(self, upload_id: str, key: str) -> dict:
        return self._http.request(
            "DELETE",
            f"{_PREFIX}/uploads/{quote(upload_id, safe='')}?key={quote(key, safe='')}",
        )
