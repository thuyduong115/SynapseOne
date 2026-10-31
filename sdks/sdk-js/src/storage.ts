/*
 * Copyright 2026 SynapseDX Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Synapse Storage client: tenant-scoped buckets, objects (binary-safe) and
 * time-limited signed links for credential-less download/upload.
 */

import { HttpClient, SynapseDXError } from './_http';

const P = '/v1/storage';

export interface StorageBucket {
  name: string;
  visibility: 'private';
  maxObjectBytes: number;
  createdAt: string;
  createdBy: string | null;
}

export interface StorageObject {
  bucket: string;
  key: string;
  size: number;
  etag: string;
  contentType: string;
  lastModified: string;
}

export interface StorageListResult {
  bucket: string;
  items: Array<{ key: string; size: number; etag: string; lastModified: string }>;
  prefixes: string[];
  nextCursor: string | null;
}

export interface StorageSignedLink {
  method: 'GET' | 'PUT';
  bucket: string;
  key: string;
  /** Absolute when STORAGE_PUBLIC_BASE_URL is set, else equal to `path`. */
  url: string;
  /** Gateway-relative path (`/v1/storage/signed/<token>`). */
  path: string;
  expiresAt: string;
  contentType?: string;
  maxBytes?: number;
}

export type StorageBody = string | Uint8Array | ArrayBuffer | Blob;

/** Encode an object key for the URL path while keeping '/' separators. */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export class StorageService {
  constructor(private readonly http: HttpClient) {}

  private b(bucket: string): string {
    return `${P}/buckets/${encodeURIComponent(bucket)}`;
  }

  stats() {
    return this.http.req<{ backend: string; buckets: number; maxObjectBytes: number; maxBuckets: number }>(`${P}/stats`);
  }

  // ---- buckets ----
  listBuckets() {
    return this.http.req<StorageBucket[]>(`${P}/buckets`);
  }
  createBucket(name: string, opts: { maxObjectBytes?: number } = {}) {
    return this.http.req<StorageBucket>(`${P}/buckets`, {
      method: 'POST',
      body: JSON.stringify({ name, ...(opts.maxObjectBytes !== undefined ? { maxObjectBytes: opts.maxObjectBytes } : {}) }),
    });
  }
  getBucket(name: string) {
    return this.http.req<StorageBucket>(this.b(name));
  }
  deleteBucket(name: string, opts: { force?: boolean } = {}) {
    return this.http.req<{ deleted: boolean; bucket: string; objectsDeleted: number }>(
      `${this.b(name)}${opts.force ? '?force=true' : ''}`,
      { method: 'DELETE' },
    );
  }

  // ---- objects ----
  listObjects(bucket: string, opts: { prefix?: string; delimiter?: '/'; cursor?: string; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (opts.prefix) qs.set('prefix', opts.prefix);
    if (opts.delimiter) qs.set('delimiter', opts.delimiter);
    if (opts.cursor) qs.set('cursor', opts.cursor);
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    const q = qs.toString();
    return this.http.req<StorageListResult>(`${this.b(bucket)}/objects${q ? `?${q}` : ''}`);
  }

  putObject(bucket: string, key: string, body: StorageBody, contentType = 'application/octet-stream') {
    return this.http.req<StorageObject>(`${this.b(bucket)}/objects/${encodeKey(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: body as any,
    });
  }

  /** Download an object as bytes (+ the stored content type and ETag). */
  async getObject(bucket: string, key: string): Promise<{ data: Uint8Array; contentType: string; etag: string }> {
    return this.download(`${this.b(bucket)}/objects/${encodeKey(key)}`, true);
  }

  /** Convenience: download and decode as UTF-8 text. */
  async getObjectText(bucket: string, key: string): Promise<string> {
    const { data } = await this.getObject(bucket, key);
    return new TextDecoder().decode(data);
  }

  deleteObject(bucket: string, key: string) {
    return this.http.req<{ deleted: boolean; bucket: string; key: string }>(`${this.b(bucket)}/objects/${encodeKey(key)}`, { method: 'DELETE' });
  }

  // ---- signed links ----
  presignDownload(bucket: string, key: string, expiresIn?: number) {
    return this.http.req<StorageSignedLink>(`${this.b(bucket)}/presign-download`, {
      method: 'POST', body: JSON.stringify({ key, ...(expiresIn !== undefined ? { expiresIn } : {}) }),
    });
  }
  presignUpload(bucket: string, key: string, opts: { contentType?: string; expiresIn?: number } = {}) {
    return this.http.req<StorageSignedLink>(`${this.b(bucket)}/presign-upload`, {
      method: 'POST', body: JSON.stringify({ key, ...opts }),
    });
  }
  /** Fetch through a signed link (no credentials are sent). */
  downloadSigned(link: StorageSignedLink | string) {
    return this.download(typeof link === 'string' ? link : link.path, false);
  }
  /** Upload through a signed link (no credentials are sent). */
  async uploadSigned(link: StorageSignedLink, body: StorageBody) {
    const r = await this.raw(link.path, { method: 'PUT', body: body as any, headers: { 'Content-Type': link.contentType || 'application/octet-stream' } }, false);
    return (await r.json()) as StorageObject;
  }

  // ---- binary plumbing (the JSON HttpClient cannot carry bytes back) ----
  private async raw(pathOrUrl: string, init: RequestInit, withAuth: boolean): Promise<Response> {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.http.baseUrl}${pathOrUrl}`;
    const headers = withAuth
      ? this.http.headers((init.headers as Record<string, string>) || {})
      : { ...((init.headers as Record<string, string>) || {}) };
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), this.http.timeoutMs);
    let r: Response;
    try {
      r = await fetch(url, { ...init, headers, signal: ctl.signal });
    } catch (e: any) {
      throw new SynapseDXError(`synapsedx network ${pathOrUrl}: ${e?.message || e}`);
    } finally {
      clearTimeout(to);
    }
    if (!r.ok) {
      const text = (await r.text()).slice(0, 2000);
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = undefined; }
      throw new SynapseDXError(`synapsedx ${r.status} ${pathOrUrl}: ${text}`, { status: r.status, body });
    }
    return r;
  }

  private async download(pathOrUrl: string, withAuth: boolean) {
    const r = await this.raw(pathOrUrl, { method: 'GET' }, withAuth);
    return {
      data: new Uint8Array(await r.arrayBuffer()),
      contentType: r.headers.get('content-type') || 'application/octet-stream',
      etag: (r.headers.get('etag') || '').replace(/"/g, ''),
    };
  }
}
