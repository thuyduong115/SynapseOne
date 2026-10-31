# Copyright 2026 SynapseDX Contributors
# Licensed under the Apache License, Version 2.0 (the "License");
"""Synapse Storage client: tenant-scoped buckets, binary-safe objects and
time-limited signed links for credential-less download/upload.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode

import requests

from ._http import HttpClient, SynapseDXError, _try_json

_P = "/v1/storage"


def encode_key(key: str) -> str:
    """Encode an object key for the URL path, keeping '/' separators."""
    return "/".join(quote(seg, safe="") for seg in str(key).split("/"))


class StorageService:
    """Typed methods for every ``/v1/storage`` endpoint exposed by the gateway."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def _req(self, method: str, path: str, body: Any | None = None) -> Any:
        return self._http.request(method, path, body)

    @staticmethod
    def _b(bucket: str) -> str:
        return f"{_P}/buckets/{quote(str(bucket), safe='')}"

    def stats(self) -> dict:
        """Backend, bucket count and limits for the tenant."""
        return self._req("GET", f"{_P}/stats")

    # ---- buckets ----
    def list_buckets(self) -> list:
        return self._req("GET", f"{_P}/buckets")

    def create_bucket(self, name: str, max_object_bytes: int | None = None) -> dict:
        body: dict = {"name": name}
        if max_object_bytes is not None:
            body["maxObjectBytes"] = max_object_bytes
        return self._req("POST", f"{_P}/buckets", body)

    def get_bucket(self, name: str) -> dict:
        return self._req("GET", self._b(name))

    def delete_bucket(self, name: str, force: bool = False) -> dict:
        """Delete a bucket; ``force=True`` also deletes its objects."""
        return self._req("DELETE", self._b(name) + ("?force=true" if force else ""))

    # ---- objects ----
    def list_objects(
        self,
        bucket: str,
        prefix: str | None = None,
        delimiter: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict:
        params = {
            k: v
            for k, v in {
                "prefix": prefix,
                "delimiter": delimiter,
                "cursor": cursor,
                "limit": limit,
            }.items()
            if v is not None
        }
        qs = f"?{urlencode(params)}" if params else ""
        return self._req("GET", f"{self._b(bucket)}/objects{qs}")

    def put_object(
        self,
        bucket: str,
        key: str,
        data: bytes | str,
        content_type: str = "application/octet-stream",
    ) -> dict:
        """Upload raw bytes (str is encoded as UTF-8)."""
        body = data.encode("utf-8") if isinstance(data, str) else data
        r = self._raw(
            "PUT",
            f"{self._b(bucket)}/objects/{encode_key(key)}",
            data=body,
            content_type=content_type,
            auth=True,
        )
        return r.json()

    def get_object(self, bucket: str, key: str) -> dict:
        """Download an object → ``{"data": bytes, "content_type", "etag"}``."""
        return self._download(f"{self._b(bucket)}/objects/{encode_key(key)}", auth=True)

    def get_object_text(self, bucket: str, key: str) -> str:
        return self.get_object(bucket, key)["data"].decode("utf-8")

    def delete_object(self, bucket: str, key: str) -> dict:
        return self._req("DELETE", f"{self._b(bucket)}/objects/{encode_key(key)}")

    # ---- signed links ----
    def presign_download(
        self, bucket: str, key: str, expires_in: int | None = None
    ) -> dict:
        body: dict = {"key": key}
        if expires_in is not None:
            body["expiresIn"] = expires_in
        return self._req("POST", f"{self._b(bucket)}/presign-download", body)

    def presign_upload(
        self,
        bucket: str,
        key: str,
        content_type: str | None = None,
        expires_in: int | None = None,
    ) -> dict:
        body: dict = {"key": key}
        if content_type is not None:
            body["contentType"] = content_type
        if expires_in is not None:
            body["expiresIn"] = expires_in
        return self._req("POST", f"{self._b(bucket)}/presign-upload", body)

    def download_signed(self, link: dict | str) -> dict:
        """Fetch through a signed link (no credentials are sent)."""
        path = link if isinstance(link, str) else link["path"]
        return self._download(path, auth=False)

    def upload_signed(self, link: dict, data: bytes | str) -> dict:
        """Upload through a signed link (no credentials are sent)."""
        body = data.encode("utf-8") if isinstance(data, str) else data
        r = self._raw(
            "PUT",
            link["path"],
            data=body,
            content_type=link.get("contentType") or "application/octet-stream",
            auth=False,
        )
        return r.json()

    # ---- binary plumbing (HttpClient.request is JSON-only) ----
    def _raw(
        self,
        method: str,
        path_or_url: str,
        data: bytes | None = None,
        content_type: str | None = None,
        auth: bool = True,
    ) -> requests.Response:
        url = (
            path_or_url
            if path_or_url.startswith(("http://", "https://"))
            else self._http.base_url + path_or_url
        )
        headers = dict(self._http.headers()) if auth else {}
        headers.pop("Content-Type", None)
        if content_type:
            headers["Content-Type"] = content_type
        try:
            r = requests.request(
                method, url, data=data, headers=headers, timeout=self._http.timeout
            )
        except Exception as e:  # network, DNS, timeout...
            raise SynapseDXError(f"synapsedx network {path_or_url}: {e}") from e
        if r.status_code >= 400:
            raise SynapseDXError(
                f"synapsedx {r.status_code} {path_or_url}: {r.text[:500]}",
                status=r.status_code,
                body=_try_json(r),
            )
        return r

    def _download(self, path_or_url: str, auth: bool) -> dict:
        r = self._raw("GET", path_or_url, auth=auth)
        return {
            "data": r.content,
            "content_type": r.headers.get("Content-Type", "application/octet-stream"),
            "etag": (r.headers.get("ETag") or "").replace('"', ""),
        }
