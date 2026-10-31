// Copyright 2026 SynapseDX Contributors
// Licensed under the Apache License, Version 2.0 (the "License");
// Synapse Storage: tenant-scoped buckets, binary-safe objects and
// time-limited signed links for credential-less download/upload.
package synapsedx

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// StorageBucket is a logical, tenant-scoped bucket.
type StorageBucket struct {
	Name           string  `json:"name"`
	Visibility     string  `json:"visibility"`
	MaxObjectBytes int64   `json:"maxObjectBytes"`
	CreatedAt      string  `json:"createdAt"`
	CreatedBy      *string `json:"createdBy"`
}

// StorageObject describes a stored object.
type StorageObject struct {
	Bucket       string `json:"bucket"`
	Key          string `json:"key"`
	Size         int64  `json:"size"`
	ETag         string `json:"etag"`
	ContentType  string `json:"contentType"`
	LastModified string `json:"lastModified"`
}

// StorageListResult is one page of an object listing.
type StorageListResult struct {
	Bucket string `json:"bucket"`
	Items  []struct {
		Key          string `json:"key"`
		Size         int64  `json:"size"`
		ETag         string `json:"etag"`
		LastModified string `json:"lastModified"`
	} `json:"items"`
	Prefixes   []string `json:"prefixes"`
	NextCursor *string  `json:"nextCursor"`
}

// StorageSignedLink is a time-limited download (GET) or upload (PUT) link.
type StorageSignedLink struct {
	Method      string `json:"method"`
	Bucket      string `json:"bucket"`
	Key         string `json:"key"`
	URL         string `json:"url"`
	Path        string `json:"path"`
	ExpiresAt   string `json:"expiresAt"`
	ContentType string `json:"contentType,omitempty"`
	MaxBytes    int64  `json:"maxBytes,omitempty"`
}

// StorageListOptions filters an object listing.
type StorageListOptions struct {
	Prefix    string
	Delimiter string // "/" groups keys into Prefixes
	Cursor    string
	Limit     int
}

// StorageDownload is an object's bytes plus its stored metadata.
type StorageDownload struct {
	Data        []byte
	ContentType string
	ETag        string
}

// EncodeStorageKey escapes each key segment while keeping '/' separators.
func EncodeStorageKey(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}

func storageBucketPath(bucket string) string { return "/v1/storage/buckets/" + pathEscape(bucket) }

// StorageStats returns the backend, bucket count and limits for the tenant.
func (c *Client) StorageStats() (map[string]any, error) {
	return c.doMap("GET", "/v1/storage/stats", nil)
}

// ListBuckets lists the tenant's buckets.
func (c *Client) ListBuckets() ([]StorageBucket, error) {
	b, err := c.do("GET", "/v1/storage/buckets", nil)
	if err != nil {
		return nil, err
	}
	var out []StorageBucket
	return out, unmarshal(b, &out)
}

// CreateBucket creates a private bucket; maxObjectBytes <= 0 keeps the service default.
func (c *Client) CreateBucket(name string, maxObjectBytes int64) (*StorageBucket, error) {
	body := map[string]any{"name": name}
	if maxObjectBytes > 0 {
		body["maxObjectBytes"] = maxObjectBytes
	}
	b, err := c.do("POST", "/v1/storage/buckets", body)
	if err != nil {
		return nil, err
	}
	var out StorageBucket
	return &out, unmarshal(b, &out)
}

// GetBucket returns a bucket's configuration.
func (c *Client) GetBucket(name string) (*StorageBucket, error) {
	b, err := c.do("GET", storageBucketPath(name), nil)
	if err != nil {
		return nil, err
	}
	var out StorageBucket
	return &out, unmarshal(b, &out)
}

// DeleteBucket deletes a bucket; force also deletes its objects.
func (c *Client) DeleteBucket(name string, force bool) (map[string]any, error) {
	p := storageBucketPath(name)
	if force {
		p += "?force=true"
	}
	return c.doMap("DELETE", p, nil)
}

// ListObjects lists objects in a bucket.
func (c *Client) ListObjects(bucket string, opts StorageListOptions) (*StorageListResult, error) {
	q := url.Values{}
	if opts.Prefix != "" {
		q.Set("prefix", opts.Prefix)
	}
	if opts.Delimiter != "" {
		q.Set("delimiter", opts.Delimiter)
	}
	if opts.Cursor != "" {
		q.Set("cursor", opts.Cursor)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	p := storageBucketPath(bucket) + "/objects"
	if len(q) > 0 {
		p += "?" + q.Encode()
	}
	b, err := c.do("GET", p, nil)
	if err != nil {
		return nil, err
	}
	var out StorageListResult
	return &out, unmarshal(b, &out)
}

// PutObject uploads raw bytes with the given content type.
func (c *Client) PutObject(bucket, key string, data []byte, contentType string) (*StorageObject, error) {
	b, _, err := c.raw("PUT", storageBucketPath(bucket)+"/objects/"+EncodeStorageKey(key), data, contentType, true)
	if err != nil {
		return nil, err
	}
	var out StorageObject
	return &out, unmarshal(b, &out)
}

// GetObject downloads an object's bytes.
func (c *Client) GetObject(bucket, key string) (*StorageDownload, error) {
	b, h, err := c.raw("GET", storageBucketPath(bucket)+"/objects/"+EncodeStorageKey(key), nil, "", true)
	if err != nil {
		return nil, err
	}
	return &StorageDownload{Data: b, ContentType: h.Get("Content-Type"), ETag: strings.Trim(h.Get("ETag"), `"`)}, nil
}

// DeleteObject deletes an object.
func (c *Client) DeleteObject(bucket, key string) error {
	_, err := c.do("DELETE", storageBucketPath(bucket)+"/objects/"+EncodeStorageKey(key), nil)
	return err
}

// PresignDownload creates a time-limited download link (expiresIn <= 0 = service default).
func (c *Client) PresignDownload(bucket, key string, expiresIn int) (*StorageSignedLink, error) {
	body := map[string]any{"key": key}
	if expiresIn > 0 {
		body["expiresIn"] = expiresIn
	}
	b, err := c.do("POST", storageBucketPath(bucket)+"/presign-download", body)
	if err != nil {
		return nil, err
	}
	var out StorageSignedLink
	return &out, unmarshal(b, &out)
}

// PresignUpload creates a time-limited upload link pinned to key + content type.
func (c *Client) PresignUpload(bucket, key, contentType string, expiresIn int) (*StorageSignedLink, error) {
	body := map[string]any{"key": key}
	if contentType != "" {
		body["contentType"] = contentType
	}
	if expiresIn > 0 {
		body["expiresIn"] = expiresIn
	}
	b, err := c.do("POST", storageBucketPath(bucket)+"/presign-upload", body)
	if err != nil {
		return nil, err
	}
	var out StorageSignedLink
	return &out, unmarshal(b, &out)
}

// DownloadSigned fetches through a signed link (no credentials are sent).
func (c *Client) DownloadSigned(link *StorageSignedLink) (*StorageDownload, error) {
	b, h, err := c.raw("GET", link.Path, nil, "", false)
	if err != nil {
		return nil, err
	}
	return &StorageDownload{Data: b, ContentType: h.Get("Content-Type"), ETag: strings.Trim(h.Get("ETag"), `"`)}, nil
}

// UploadSigned uploads through a signed link (no credentials are sent).
func (c *Client) UploadSigned(link *StorageSignedLink, data []byte) (*StorageObject, error) {
	ct := link.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	b, _, err := c.raw("PUT", link.Path, data, ct, false)
	if err != nil {
		return nil, err
	}
	var out StorageObject
	return &out, unmarshal(b, &out)
}

// raw is the binary-safe request path (c.do is JSON-only).
func (c *Client) raw(method, path string, data []byte, contentType string, auth bool) ([]byte, http.Header, error) {
	var r io.Reader
	if data != nil {
		r = bytes.NewReader(data)
	}
	target := path
	if !strings.HasPrefix(path, "http://") && !strings.HasPrefix(path, "https://") {
		target = c.BaseURL + path
	}
	req, err := http.NewRequest(method, target, r)
	if err != nil {
		return nil, nil, fmt.Errorf("synapsedx request %s: %w", path, err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if auth {
		if c.Token != "" {
			req.Header.Set("Authorization", "Bearer "+c.Token)
		}
		if c.APIKey != "" {
			req.Header.Set("X-API-Key", c.APIKey)
		}
		if c.Tenant != "" {
			req.Header.Set("x-synapsedx-tenant", c.Tenant)
		}
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("synapsedx network %s: %w", path, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<30))
	if err != nil {
		return nil, nil, fmt.Errorf("synapsedx read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("synapsedx %d %s: %s", resp.StatusCode, path, truncate(string(b), 500))
	}
	return b, resp.Header, nil
}
