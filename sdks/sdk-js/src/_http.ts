// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Shared fetch-based HTTP plumbing for the synapseone JavaScript SDK.
 */

/** Public API gateway origin. The console/marketing host is NOT the API. */
export const DEFAULT_BASE_URL = 'https://api.synapseone.space';

/** Default per-request timeout. Long-running namespaces override it. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Inference/LLM calls routinely exceed 15s; keep in sync with the gateway route. */
export const INFERENCE_TIMEOUT_MS = 120_000;
/** Public inbound webhooks can run up to the workflow 300s budget. */
export const WEBHOOK_TIMEOUT_MS = 300_000;

export interface SynapseOneClientOptions {
  baseUrl?: string; // gateway, defaults to https://api.synapseone.space or $SYNAPSEONE_BASE_URL
  token?: string; // Bearer JWT
  apiKey?: string; // X-API-Key
  tenant?: string; // x-synapseone-tenant (platform callers of faststore/queue)
  timeoutMs?: number; // default per-request timeout (default 15000)
  /** Max attempts for idempotent requests on 429/502/503/504 (default 3, 1 = no retry). */
  maxAttempts?: number;
  /** Base backoff in ms for retries (exponential, default 200). */
  retryBaseMs?: number;
}

/** Per-call transport options. */
export interface RequestOptions {
  /** Override the client/namespace timeout for this call. */
  timeoutMs?: number;
  /** Caller-supplied abort signal. */
  signal?: AbortSignal;
  /** Max total attempts for this call (1 disables retries). */
  maxAttempts?: number;
  /** Force retry eligibility (defaults to idempotent methods). */
  retryable?: boolean;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

/** All SDK failures surface as SynapseOneError (network or HTTP). */
export class SynapseOneError extends Error {
  /** HTTP status code when the failure came from a response, undefined for network errors. */
  status?: number;
  /** Parsed error body when the response carried JSON. */
  body?: unknown;
  /** Machine-readable error code (when known). */
  code?: string;
  /** Base URL the request was sent to (diagnoses console-vs-API misconfiguration). */
  baseUrl?: string;

  constructor(message: string, opts: { status?: number; body?: unknown; code?: string; baseUrl?: string } = {}) {
    super(message);
    this.name = 'SynapseOneError';
    this.status = opts.status;
    this.body = opts.body;
    this.code = opts.code;
    this.baseUrl = opts.baseUrl;
  }
}

/**
 * @deprecated Use {@link SynapseOneError}. Kept for the SynapseDX -> SynapseOne
 * rebrand window; identical class (so `instanceof` works across both names).
 */
export { SynapseOneError as SynapseDXError };

/** @deprecated Use {@link SynapseOneClientOptions}. */
export type SynapseDXClientOptions = SynapseOneClientOptions;

/** Emit a deprecation notice through Node's warning channel (console fallback). */
export function warnDeprecated(name: string, replacement: string): void {
  const message = `synapseone: ${name}() is deprecated; use ${replacement}() instead`;
  if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
    process.emitWarning(message, { type: 'DeprecationWarning' });
  } else if (typeof console !== 'undefined' && console.warn) {
    console.warn(message);
  }
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry-After is either delta-seconds or an HTTP date. Clamp to a sane max. */
function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 30_000);
  return undefined;
}

function isHtml(body: string): boolean {
  const head = body.slice(0, 256).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

export class HttpClient {
  baseUrl: string;
  token?: string;
  apiKey?: string;
  tenant?: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;

  constructor(opts: SynapseOneClientOptions = {}) {
    const raw = opts.baseUrl ?? (typeof process !== 'undefined' ? (process.env?.SYNAPSEONE_BASE_URL || process.env?.SYNAPSEDX_BASE_URL) : undefined) ?? DEFAULT_BASE_URL;
    this.baseUrl = raw.replace(/\/$/, '');
    this.token = opts.token;
    this.apiKey = opts.apiKey;
    this.tenant = opts.tenant;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 3));
    this.retryBaseMs = Math.max(0, Math.floor(opts.retryBaseMs ?? 200));
  }

  setToken(t: string): void { this.token = t; }
  setApiKey(k: string): void { this.apiKey = k; }
  setTenant(t: string | undefined): void { this.tenant = t; }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    if (this.tenant) h['x-synapseone-tenant'] = this.tenant;
    return h;
  }

  /** Low-level fetch with timeout, caller signal and bounded retries. */
  private async fetchOnce(
    path: string,
    init: RequestInit | undefined,
    opts: RequestOptions,
    timeoutMs: number,
  ): Promise<Response> {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    const to = timeoutMs > 0 ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: ctl.signal,
        headers: this.headers({ ...(init?.headers as Record<string, string>), ...(opts.headers || {}) }),
      });
    } finally {
      if (to) clearTimeout(to);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }

  async req<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
    const method = String(init?.method || 'GET').toUpperCase();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? this.maxAttempts));
    const retryable = options.retryable ?? IDEMPOTENT_METHODS.has(method);
    let attempt = 0;
    let lastErr: SynapseOneError | undefined;
    for (;;) {
      attempt++;
      let r: Response;
      try {
        r = await this.fetchOnce(path, init, options, timeoutMs);
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          throw new SynapseOneError(`synapseone timeout ${path} after ${timeoutMs}ms (base ${this.baseUrl})`, {
            code: 'timeout',
            baseUrl: this.baseUrl,
          });
        }
        lastErr = new SynapseOneError(`synapseone network ${path}: ${e?.message || e} (base ${this.baseUrl})`, {
          code: 'network_error',
          baseUrl: this.baseUrl,
        });
        if (retryable && attempt < maxAttempts) {
          await sleep(this.retryBaseMs * 2 ** (attempt - 1) + Math.random() * this.retryBaseMs);
          continue;
        }
        throw lastErr;
      }
      if (!r.ok) {
        const text = (await r.text()).slice(0, 2000);
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
        const err = new SynapseOneError(`synapseone ${r.status} ${path}: ${text} (base ${this.baseUrl})`, {
          status: r.status,
          body,
          code: (body as any)?.error,
          baseUrl: this.baseUrl,
        });
        if (retryable && RETRYABLE_STATUS.has(r.status) && attempt < maxAttempts) {
          const wait = retryAfterMs(r.headers?.get?.('retry-after') ?? null)
            ?? this.retryBaseMs * 2 ** (attempt - 1) + Math.random() * this.retryBaseMs;
          await sleep(wait);
          lastErr = err;
          continue;
        }
        throw err;
      }
      const contentType = String(r.headers?.get?.('content-type') || '').toLowerCase();
      const text = await r.text();
      if (!text) return null as T;
      if (contentType.includes('text/html') || isHtml(text)) {
        // A 200 SPA/HTML response means the base URL points at the console host,
        // not the API gateway — surface it instead of returning HTML as data.
        throw new SynapseOneError(
          `synapseone expected JSON from ${this.baseUrl}${path} but received HTML (status ${r.status}). `
          + `The base URL looks like the console/marketing host; use ${DEFAULT_BASE_URL}.`,
          { status: r.status, code: 'non_json_response', baseUrl: this.baseUrl },
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    }
  }

  /** Upload a binary body and parse the JSON response. */
  async upload<T>(path: string, body: Uint8Array | string, options: RequestOptions & { method?: string; contentType?: string } = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const r = await this.fetchOnce(path, {
      method: options.method || 'PUT',
      body: body as any,
      headers: {
        'Content-Type': options.contentType || 'application/octet-stream',
        ...(options.headers || {}),
      },
    }, options, timeoutMs);
    const text = await r.text();
    if (!r.ok) {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = undefined; }
      throw new SynapseOneError(`synapseone ${r.status} ${path}: ${text.slice(0, 500)} (base ${this.baseUrl})`, {
        status: r.status,
        body: parsed,
        baseUrl: this.baseUrl,
      });
    }
    if (!text) return null as T;
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }

  /** HEAD request; returns response headers (no body). */
  async head(path: string, options: RequestOptions = {}): Promise<Record<string, string>> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const r = await this.fetchOnce(path, { method: 'HEAD' }, options, timeoutMs);
    if (!r.ok) {
      throw new SynapseOneError(`synapseone ${r.status} ${path} (base ${this.baseUrl})`, {
        status: r.status,
        baseUrl: this.baseUrl,
      });
    }
    const out: Record<string, string> = {};
    r.headers?.forEach?.((v, k) => { out[k.toLowerCase()] = v; });
    return out;
  }

  /** Fetch a binary body (bytes). Used by object storage/file downloads. */
  async reqBinary(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<Uint8Array> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const r = await this.fetchOnce(path, init, options, timeoutMs);
    if (!r.ok) {
      const text = (await r.text()).slice(0, 2000);
      throw new SynapseOneError(`synapseone ${r.status} ${path}: ${text} (base ${this.baseUrl})`, {
        status: r.status,
        baseUrl: this.baseUrl,
      });
    }
    return new Uint8Array(await r.arrayBuffer());
  }

  /**
   * Stream a Server-Sent-Events response as parsed `{event, data}` records.
   * The transport is not buffered; each event is yielded as soon as a blank
   * line terminates it. Pass an AbortSignal to cancel.
   */
  async *stream(path: string, init?: RequestInit, options: RequestOptions = {}): AsyncGenerator<{ event: string; data: string }> {
    const timeoutMs = options.timeoutMs ?? INFERENCE_TIMEOUT_MS;
    const r = await this.fetchOnce(path, init, options, timeoutMs);
    if (!r.ok) {
      const text = (await r.text()).slice(0, 2000);
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = undefined; }
      throw new SynapseOneError(`synapseone ${r.status} ${path}: ${text} (base ${this.baseUrl})`, {
        status: r.status,
        body,
        baseUrl: this.baseUrl,
      });
    }
    const body: any = (r as any).body;
    if (!body || typeof body.getReader !== 'function') {
      // Non-streaming environment: decode the whole payload and parse SSE lines.
      const text = await r.text();
      yield* parseSse(text);
      return;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
          for (const ev of parseSse(chunk)) yield ev;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) for (const ev of parseSse(buffer)) yield ev;
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }

  /** Generic escape hatch (forward-compat with endpoints added after this SDK). */
  call(method: string, path: string, body?: unknown, options: RequestOptions = {}) {
    const m = String(method || 'GET').toUpperCase();
    return this.req(path.startsWith('/') ? path : `/${path}`, {
      method: m,
      body: body === undefined || m === 'GET' || m === 'HEAD' ? undefined : JSON.stringify(body),
    }, options);
  }
}

function* parseSse(text: string): Generator<{ event: string; data: string }> {
  let event = 'message';
  const data: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (data.length) yield { event, data: data.join('\n') };
      event = 'message';
      data.length = 0;
      continue;
    }
    if (line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length) yield { event, data: data.join('\n') };
}
