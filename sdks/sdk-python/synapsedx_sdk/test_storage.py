# Copyright 2026 SynapseDX Contributors
# Licensed under the Apache License, Version 2.0 (the "License");
"""Offline tests for Synapse Storage and the token-management IAM methods —
stdlib binary echo server, no platform."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from synapsedx_sdk import SynapseDXClient, encode_key

STORED = bytes([0, 255, 1, 254, 10])
hits: list = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # keep pytest output clean
        pass

    def _handle(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        hits.append(
            {
                "method": self.command,
                "path": self.path,
                "type": self.headers.get("Content-Type", ""),
                "auth": self.headers.get("Authorization", ""),
                "body": body,
            }
        )
        if self.command == "GET" and (
            self.path == "/v1/storage/buckets/docs/objects/a%20b/c.bin"
            or self.path.startswith("/v1/storage/signed/")
        ):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("ETag", '"e1"')
            self.send_header("Content-Length", str(len(STORED)))
            self.end_headers()
            self.wfile.write(STORED)
            return
        if self.path.endswith("/presign-download") or self.path.endswith(
            "/presign-upload"
        ):
            out = {
                "method": "PUT" if self.path.endswith("upload") else "GET",
                "path": "/v1/storage/signed/tok",
                "url": "/v1/storage/signed/tok",
                "contentType": "image/png",
            }
        else:
            out = {"ok": True, "size": len(body)}
        raw = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = do_PUT = do_DELETE = _handle


def _client():
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, SynapseDXClient(f"http://127.0.0.1:{srv.server_address[1]}", token="T")


def test_encode_key_keeps_separators():
    assert encode_key("a b/c?.bin") == "a%20b/c%3F.bin"


def test_storage_objects_and_signed_links():
    srv, c = _client()
    try:
        c.storage.create_bucket("docs", max_object_bytes=1024)
        assert hits[-1]["path"] == "/v1/storage/buckets"
        assert json.loads(hits[-1]["body"]) == {"name": "docs", "maxObjectBytes": 1024}

        c.storage.put_object("docs", "a b/c.bin", STORED)
        assert hits[-1]["method"] == "PUT"
        assert hits[-1]["path"] == "/v1/storage/buckets/docs/objects/a%20b/c.bin"
        assert hits[-1]["type"] == "application/octet-stream"
        assert hits[-1]["body"] == STORED

        got = c.storage.get_object("docs", "a b/c.bin")
        assert got["data"] == STORED and got["etag"] == "e1"
        assert hits[-1]["auth"] == "Bearer T"

        c.storage.list_objects("docs", prefix="a b/", delimiter="/", limit=10)
        assert (
            hits[-1]["path"]
            == "/v1/storage/buckets/docs/objects?prefix=a+b%2F&delimiter=%2F&limit=10"
        )

        c.storage.delete_bucket("docs", force=True)
        assert hits[-1]["path"] == "/v1/storage/buckets/docs?force=true"

        link = c.storage.presign_download("docs", "k", expires_in=60)
        assert json.loads(hits[-1]["body"]) == {"key": "k", "expiresIn": 60}
        assert c.storage.download_signed(link)["data"] == STORED
        assert hits[-1]["auth"] == "", "signed links never carry credentials"

        up = c.storage.presign_upload("docs", "k", content_type="image/png")
        c.storage.upload_signed(up, b"\x01\x02")
        assert hits[-1]["method"] == "PUT" and hits[-1]["type"] == "image/png"
        assert hits[-1]["auth"] == ""
    finally:
        srv.shutdown()


def test_token_management_methods():
    srv, c = _client()
    try:
        c.iam.rotate_api_key("k1", grace_seconds=300)
        assert hits[-1]["path"] == "/v1/keys/k1/rotate"
        assert json.loads(hits[-1]["body"]) == {"graceSeconds": 300}
        c.iam.list_sessions()
        assert hits[-1]["path"] == "/v1/auth/sessions"
        c.iam.revoke_session("s1")
        assert (hits[-1]["method"], hits[-1]["path"]) == (
            "DELETE",
            "/v1/auth/sessions/s1",
        )
        c.iam.set_org_admin("u1", True)
        assert hits[-1]["method"] == "PUT"
        assert json.loads(hits[-1]["body"]) == {"isOrgAdmin": True}
        c.iam.managed_policies()
        assert hits[-1]["path"] == "/v1/managed-policies"
        c.iam.create_managed_policy("acc1", "readers", "ReadOnlyAccess")
        assert json.loads(hits[-1]["body"]) == {
            "slug": "readers",
            "managed": "ReadOnlyAccess",
        }
        c.iam.assign_service_account_role("sa1", "r1")
        assert hits[-1]["path"] == "/v1/service-accounts/sa1/roles"
        c.iam.unassign_service_account_role("sa1", "r1")
        assert (hits[-1]["method"], hits[-1]["path"]) == (
            "DELETE",
            "/v1/service-accounts/sa1/roles/r1",
        )
        c.iam.service_account_roles("sa1")
        assert hits[-1]["method"] == "GET"
    finally:
        srv.shutdown()
