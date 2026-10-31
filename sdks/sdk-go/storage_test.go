// Copyright 2026 SynapseDX Contributors
// Licensed under the Apache License, Version 2.0 (the "License");
package synapsedx

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type hit struct {
	method, path, ctype, auth string
	body                      []byte
}

func storageServer(t *testing.T, hits *[]hit, stored []byte) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*hits = append(*hits, hit{r.Method, r.URL.RequestURI(), r.Header.Get("Content-Type"), r.Header.Get("Authorization"), b})
		p := r.URL.EscapedPath()
		if r.Method == "GET" && (p == "/v1/storage/buckets/docs/objects/a%20b/c.bin" || strings.HasPrefix(p, "/v1/storage/signed/")) {
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("ETag", `"e1"`)
			_, _ = w.Write(stored)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(p, "/presign-download"), strings.HasSuffix(p, "/presign-upload"):
			_ = json.NewEncoder(w).Encode(map[string]any{"method": "GET", "path": "/v1/storage/signed/tok", "url": "/v1/storage/signed/tok", "contentType": "image/png"})
		case r.Method == "GET" && (p == "/v1/storage/buckets" || p == "/v1/managed-policies" || p == "/v1/auth/sessions" || strings.HasSuffix(p, "/roles")):
			_, _ = w.Write([]byte(`[]`))
		default:
			_, _ = w.Write([]byte(`{"ok":true,"name":"docs","size":5}`))
		}
	}))
}

func TestStorageObjectsAndSignedLinks(t *testing.T) {
	var hits []hit
	stored := []byte{0, 255, 1, 254, 10}
	srv := storageServer(t, &hits, stored)
	defer srv.Close()
	c := New(srv.URL)
	c.SetToken("T")
	last := func() hit { return hits[len(hits)-1] }

	if _, err := c.CreateBucket("docs", 1024); err != nil {
		t.Fatal(err)
	}
	if last().path != "/v1/storage/buckets" || !strings.Contains(string(last().body), `"maxObjectBytes":1024`) {
		t.Fatalf("create bucket: %+v", last())
	}
	if _, err := c.PutObject("docs", "a b/c.bin", stored, "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	if last().method != "PUT" || last().path != "/v1/storage/buckets/docs/objects/a%20b/c.bin" || !bytes.Equal(last().body, stored) {
		t.Fatalf("put: %+v", last())
	}
	got, err := c.GetObject("docs", "a b/c.bin")
	if err != nil || !bytes.Equal(got.Data, stored) || got.ETag != "e1" || last().auth != "Bearer T" {
		t.Fatalf("get: %v %+v", err, got)
	}
	if _, err := c.ListObjects("docs", StorageListOptions{Prefix: "a b/", Delimiter: "/", Limit: 10}); err != nil {
		t.Fatal(err)
	}
	if last().path != "/v1/storage/buckets/docs/objects?delimiter=%2F&limit=10&prefix=a+b%2F" {
		t.Fatalf("list path: %s", last().path)
	}
	if _, err := c.DeleteBucket("docs", true); err != nil || last().path != "/v1/storage/buckets/docs?force=true" {
		t.Fatalf("delete bucket: %v %s", err, last().path)
	}
	link, err := c.PresignDownload("docs", "k", 60)
	if err != nil || !strings.Contains(string(last().body), `"expiresIn":60`) {
		t.Fatalf("presign: %v", err)
	}
	dl, err := c.DownloadSigned(link)
	if err != nil || !bytes.Equal(dl.Data, stored) || last().auth != "" {
		t.Fatalf("signed download: %v auth=%q", err, last().auth)
	}
	up, err := c.PresignUpload("docs", "k", "image/png", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.UploadSigned(up, []byte{1, 2}); err != nil || last().ctype != "image/png" || last().auth != "" {
		t.Fatalf("signed upload: %v %+v", err, last())
	}
	if EncodeStorageKey("a b/c?.bin") != "a%20b/c%3F.bin" {
		t.Fatalf("encode: %s", EncodeStorageKey("a b/c?.bin"))
	}
}

func TestTokenManagementMethods(t *testing.T) {
	var hits []hit
	srv := storageServer(t, &hits, nil)
	defer srv.Close()
	c := New(srv.URL)
	last := func() hit { return hits[len(hits)-1] }

	if _, err := c.RotateAPIKey("k1", 300); err != nil || last().path != "/v1/keys/k1/rotate" || !strings.Contains(string(last().body), `"graceSeconds":300`) {
		t.Fatalf("rotate: %v %+v", err, last())
	}
	if _, err := c.ListSessions(); err != nil || last().path != "/v1/auth/sessions" {
		t.Fatalf("sessions: %v", err)
	}
	if err := c.RevokeSession("s1"); err != nil || last().method != "DELETE" || last().path != "/v1/auth/sessions/s1" {
		t.Fatalf("revoke session: %v", err)
	}
	if _, err := c.SetOrgAdmin("u1", true); err != nil || last().method != "PUT" || !strings.Contains(string(last().body), `"isOrgAdmin":true`) {
		t.Fatalf("org admin: %v", err)
	}
	if _, err := c.ManagedPolicies(); err != nil || last().path != "/v1/managed-policies" {
		t.Fatalf("managed: %v", err)
	}
	if _, err := c.CreateManagedPolicy("acc1", "readers", "ReadOnlyAccess"); err != nil || !strings.Contains(string(last().body), `"managed":"ReadOnlyAccess"`) {
		t.Fatalf("create managed: %v", err)
	}
	if err := c.AssignServiceAccountRole("sa1", "r1"); err != nil || last().path != "/v1/service-accounts/sa1/roles" {
		t.Fatalf("assign sa role: %v", err)
	}
	if err := c.UnassignServiceAccountRole("sa1", "r1"); err != nil || last().path != "/v1/service-accounts/sa1/roles/r1" {
		t.Fatalf("unassign sa role: %v", err)
	}
	if _, err := c.ServiceAccountRoles("sa1"); err != nil || last().method != "GET" {
		t.Fatalf("sa roles: %v", err)
	}
}
