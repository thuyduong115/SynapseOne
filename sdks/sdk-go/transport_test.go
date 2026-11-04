// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
// Copyright 2026 SynapseOne Contributors
// Licensed under the Apache License, Version 2.0 (the "License");

package synapseone

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestDefaultBaseURLIsGateway(t *testing.T) {
	if DefaultBaseURL != "https://api.synapseone.space" {
		t.Fatalf("default base URL must be the API gateway, got %s", DefaultBaseURL)
	}
}

func TestHTML2xxIsTypedError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("<!doctype html><html>console</html>"))
	}))
	defer srv.Close()
	c := New(srv.URL)
	c.MaxAttempts = 1
	_, err := c.do("GET", "/v1/orgs", nil)
	var api *APIError
	if !errors.As(err, &api) {
		t.Fatalf("expected APIError, got %v", err)
	}
	if api.Code != "non_json_response" {
		t.Fatalf("expected non_json_response, got %q", api.Code)
	}
	if api.StatusCode != 200 {
		t.Fatalf("expected status 200, got %d", api.StatusCode)
	}
}

func TestRetriesIdempotentRequests(t *testing.T) {
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&n, 1) < 3 {
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"error":"unavailable"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	c := New(srv.URL)
	c.MaxAttempts = 3
	c.RetryBase = time.Millisecond
	if _, err := c.do("GET", "/v1/flaky", nil); err != nil {
		t.Fatalf("expected retry success, got %v", err)
	}
	if got := atomic.LoadInt32(&n); got != 3 {
		t.Fatalf("expected 3 attempts, got %d", got)
	}
}

func TestDoesNotRetryPostsByDefault(t *testing.T) {
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&n, 1)
		w.WriteHeader(503)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	c := New(srv.URL)
	c.MaxAttempts = 3
	c.RetryBase = time.Millisecond
	_, err := c.do("POST", "/v1/x", map[string]any{"a": 1})
	var api *APIError
	if !errors.As(err, &api) || api.StatusCode != 503 {
		t.Fatalf("expected 503 APIError, got %v", err)
	}
	if got := atomic.LoadInt32(&n); got != 1 {
		t.Fatalf("expected a single POST attempt, got %d", got)
	}
}

func TestPerCallTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(300 * time.Millisecond)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	c := New(srv.URL)
	c.MaxAttempts = 1
	started := time.Now()
	_, err := c.doWithTimeout("GET", "/slow", nil, 40*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if time.Since(started) > 2*time.Second {
		t.Fatalf("timeout override not applied: %s", time.Since(started))
	}
}

func TestReadyReturnsDegradedPayload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok","service":"gateway","version":"0"}`))
		case "/ready":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(503)
			_, _ = fmt.Fprint(w, `{"status":"degraded","service":"gateway","version":"0","upstreams":[{"name":"base","ok":false}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c := New(srv.URL)
	c.MaxAttempts = 1
	ready, err := c.Ready()
	if err != nil {
		t.Fatalf("Ready must return the degraded payload, got %v", err)
	}
	if ready["status"] != "degraded" {
		t.Fatalf("expected degraded, got %v", ready["status"])
	}
	if _, err := c.ReadyStrict(); err == nil {
		t.Fatal("ReadyStrict must fail on 503")
	}
}
