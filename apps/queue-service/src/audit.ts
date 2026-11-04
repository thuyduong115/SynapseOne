// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Data-plane mutation audit trail (#32).
 *
 * Every non-GET /v1/* request produces one bounded audit event with the actor,
 * tenant, action, resource and result. Events are buffered in memory and
 * shipped to IAM's internal ingest endpoint in batches, using the same
 * best-effort model as gateway usage telemetry: an unavailable audit sink must
 * never fail a data write.
 *
 * Privacy: request bodies, query strings, Authorization headers and values of
 * secret-looking path parameters are never recorded. IAM merges the event into
 * the tenant-scoped audit_log projection served by GET /v1/audit.
 */
import type express from 'express';

export type AuditResult = 'allowed' | 'denied' | 'error';

export interface AuditEvent {
  actorType: 'user' | 'service' | 'apikey' | 'anonymous';
  actorId: string;
  orgId: string | null;
  accountId: string | null;
  action: string;
  resource: string;
  result: AuditResult;
  statusCode: number;
  requestId: string;
  context: Record<string, unknown>;
}

const MAX_BUFFER = 1000;
const MAX_BATCH = 100;
const FLUSH_INTERVAL_MS = 5000;
const POST_TIMEOUT_MS = 3000;

const buffer: AuditEvent[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;
let lastWarn = 0;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MUTATION_VERBS = new Set([
  'batch', 'purge', 'ack', 'nack', 'heartbeat', 'replay', 'expire', 'incr',
  'push', 'pop', 'trim', 'add', 'remove', 'acquire', 'release', 'extend',
  'execute', 'activate', 'deactivate', 'rotate', 'start', 'callback', 'login',
  'logout', 'refresh', 'verify', 'reset', 'change', 'ingest', 'publish',
]);
// POST routes that only read: they must not inflate the mutation trail.
const READ_TAILS = new Set(['query', 'vector-search', 'contains', 'score', 'rank', 'read', 'search']);

const SENSITIVE_PARAM = /(pass|secret|token|key|credential|auth|email|phone|session)/i;

function header(req: express.Request, name: string): string {
  const legacy = name.startsWith('x-synapseone-') ? name.replace('x-synapseone-', 'x-synapsedx-') : name;
  const raw = req.headers[name] ?? req.headers[legacy];
  const value = Array.isArray(raw) ? raw[0] : raw || '';
  return String(value).trim();
}

function clean(value: unknown, max = 128): string {
  const s = String(value ?? '').replace(/[\r\n\u0000-\u001f]/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function auditEnabled(): boolean {
  return (process.env.AUDIT_TRAIL || 'true') !== 'false';
}

/** Gateway-stamped principal (the gateway strips spoofed client headers). */
export function auditActor(req: express.Request): Pick<AuditEvent, 'actorType' | 'actorId' | 'orgId' | 'accountId'> {
  const user = clean(header(req, 'x-synapseone-user'), 128) || null;
  const org = clean(header(req, 'x-synapseone-org'), 128) || null;
  const account = clean(header(req, 'x-synapseone-account'), 128) || null;
  const kind = clean(header(req, 'x-synapseone-kind'), 32).toLowerCase();
  if (user) {
    return {
      actorType: kind === 'apikey' || kind === 'service-account' ? 'service' : 'user',
      actorId: user,
      orgId: org,
      accountId: account,
    };
  }
  if (account) return { actorType: 'apikey', actorId: `apikey:${account}`, orgId: org, accountId: account };
  return { actorType: 'anonymous', actorId: '', orgId: org, accountId: account };
}

function sanitizedParams(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  const params = (req.params || {}) as Record<string, string>;
  for (const [name, value] of Object.entries(params)) {
    if (!value) continue;
    out[clean(name, 32)] = SENSITIVE_PARAM.test(name) ? '***' : clean(value, 128);
  }
  return out;
}

/** Stable action name, e.g. `base:collections.documents:create`. */
export function mutationAction(service: string, req: express.Request): string {
  const routePath = String((req.route && req.route.path) || req.path || '/');
  const all = routePath.replace(/^\/v1\//, '').split('/').filter(Boolean);
  // Service names and route mounts differ (workflow -> /v1/workflows). Drop the
  // mount segment so the resource starts at the first product resource.
  const mount = all[0] || service;
  const isMount = mount === service || mount === `${service}s` || mount === `${service}-service`;
  const rest = isMount ? all.slice(1) : all;
  const statics = rest.filter((s) => !s.startsWith(':'));
  let verb = req.method === 'POST' ? 'create'
    : req.method === 'PUT' || req.method === 'PATCH' ? 'update'
      : 'delete';
  const tail = statics[statics.length - 1];
  if (tail && MUTATION_VERBS.has(tail) && (statics.length > 1 || rest.length > statics.length)) {
    verb = tail;
    statics.pop();
  }
  const resource = statics.slice(0, 3).join('.') || mount || 'root';
  return `${service}:${resource}:${verb}`;
}

function isReadOnlyPost(req: express.Request): boolean {
  if (req.method !== 'POST') return false;
  const routePath = String((req.route && req.route.path) || req.path || '');
  const tail = routePath.split('/').filter(Boolean).pop() || '';
  return READ_TAILS.has(tail);
}

function ingestUrl(): string {
  if (process.env.AUDIT_INGEST_URL) return process.env.AUDIT_INGEST_URL;
  const base = (process.env.IAM_SERVICE_URL || 'http://iam:4001').replace(/\/$/, '');
  return `${base}/v1/audit/ingest`;
}

function warnOnce(msg: string): void {
  const now = Date.now();
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  console.warn(`[audit] ${msg}`);
}

/** Evaluate one request and append its audit event (no-op for reads). */
export function auditRequest(req: express.Request, service: string, result: AuditResult): AuditEvent | null {
  if (!auditEnabled()) return null;
  const routePath = String((req.route && req.route.path) || req.path || '/');
  const event: AuditEvent = {
    ...auditActor(req),
    action: mutationAction(service, req),
    resource: clean(`${service}:${routePath}`, 512),
    result,
    statusCode: Number(req.res?.statusCode) || 0,
    requestId: clean(header(req, 'x-request-id'), 128),
    context: {
      service,
      method: req.method,
      route: clean(routePath, 256),
      params: sanitizedParams(req),
      result,
    },
  };
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  if (!timer) {
    timer = setInterval(() => { void flushAuditNow(); }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }
  return event;
}

/** Express middleware: emit one event per mutation after the response ends. */
export function auditMiddleware(service: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    if (!MUTATING_METHODS.has(req.method) || !String(req.path || '').startsWith('/v1/') || isReadOnlyPost(req)) {
      return next();
    }
    res.on('finish', () => {
      const status = Number(res.statusCode) || 0;
      const result: AuditResult = status < 400 ? 'allowed' : status < 500 ? 'denied' : 'error';
      try { auditRequest(req, service, result); } catch { /* audit never breaks a write */ }
    });
    next();
  };
}

async function postBatch(events: AuditEvent[]): Promise<void> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), POST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.SYNAPSEONE_INTERNAL_SECRET) {
      headers['x-synapseone-internal'] = process.env.SYNAPSEONE_INTERNAL_SECRET;
    }
    const res = await fetch(ingestUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`IAM audit ingest HTTP ${res.status}`);
  } finally {
    clearTimeout(to);
  }
}

/** Flush at most one batch; failures are re-buffered (bounded, no data loss
 *  beyond the ring buffer itself). */
export async function flushAuditNow(): Promise<void> {
  if (flushing || !auditEnabled() || buffer.length === 0) return;
  const batch = buffer.splice(0, MAX_BATCH);
  flushing = true;
  try {
    await postBatch(batch);
  } catch (e: any) {
    buffer.unshift(...batch);
    if (buffer.length > MAX_BUFFER) buffer.splice(buffer.length - MAX_BUFFER);
    warnOnce(`ingest failed (${e?.message || e}); keeping ${buffer.length} event(s)`);
  } finally {
    flushing = false;
  }
}

/** Test/diagnostic helpers. */
export function __auditEvents(): AuditEvent[] {
  return buffer.map((e) => ({ ...e, context: { ...e.context } }));
}
export function __clearAudit(): void {
  buffer.length = 0;
  if (timer) clearInterval(timer);
  timer = null;
  flushing = false;
  lastWarn = 0;
}
export const __flushAudit = flushAuditNow;
