/*
 * Copyright 2026 SynapseDX Contributors
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Synapse Storage — tenant-scoped object storage (unstructured data: files,
 * images, documents) on any S3-compatible backend, with an in-memory
 * fallback for dev/test.
 *
 *  - logical buckets per tenant (org > account > user), created on demand
 *  - put/get/head/delete/list objects (keys may contain '/')
 *  - time-limited HMAC-signed links for download/upload without credentials
 *    (served through the gateway, so the S3 backend never has to be public)
 *
 * Auth matches the rest of the platform: gateway-stamped x-synapsedx-* headers
 * and the shared SYNAPSEDX_INTERNAL_SECRET for direct service-to-service calls.
 * Fine-grained permissions (storage:Read/Write/Delete) are enforced centrally
 * by the gateway (AUTHZ_MODE) against IAM policies.
 */
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createHmac, timingSafeEqual } from 'crypto';
import { backendFromEnv, type ObjectBackend, type ObjectInfo } from './store';

dotenv.config();
const PORT = Number(process.env.PORT || 4010);
const VERSION = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
const IS_PROD = process.env.NODE_ENV === 'production';

function envInt(name: string, def: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? def);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), min), max) : def;
}
const MAX_OBJECT_BYTES = envInt('STORAGE_MAX_OBJECT_BYTES', 25 * 1024 * 1024, 1024, 1024 * 1024 * 1024);
const MAX_BUCKETS_PER_TENANT = envInt('STORAGE_MAX_BUCKETS', 100, 1, 10000);
const MAX_SIGNED_TTL = envInt('STORAGE_SIGNED_URL_MAX_TTL', 7 * 24 * 3600, 60, 30 * 24 * 3600);
const MAX_KEY_LENGTH = 1024;
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const CONTENT_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(\s*;\s*[a-z0-9-]+=[A-Za-z0-9._-]+)?$/i;
/** Types rendered inline on download; everything else is forced to attachment
 *  (user uploads are served from the API origin — never as active content). */
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|text\/plain|application\/json|video\/(mp4|webm)|audio\/(mpeg|ogg|wav))$/i;

// ---------- caller / tenant (same contract as Faststore/Queue) ----------

export interface Principal {
  sub: string;
  org?: string;
  account?: string;
  kind?: string;
}

function header(req: express.Request, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v || '').trim();
}

export function principalFromHeaders(req: express.Request): Principal | null {
  const clean = (v: string): string | undefined => (v && v.length <= 128 ? v : undefined);
  const user = header(req, 'x-synapsedx-user');
  if (user) {
    if (user.length > 128) return null;
    return { sub: user, org: clean(header(req, 'x-synapsedx-org')), account: clean(header(req, 'x-synapsedx-account')), kind: clean(header(req, 'x-synapsedx-kind')) };
  }
  // API keys: kind=apikey + account, no user. Any tenant marker = principal,
  // never platform (which would be a cross-tenant superuser).
  const kind = clean(header(req, 'x-synapsedx-kind'));
  const account = clean(header(req, 'x-synapsedx-account'));
  const org = clean(header(req, 'x-synapsedx-org'));
  if (kind || account || org) {
    return { sub: account ? `apikey:${account}` : `${kind || 'principal'}:unknown`, org, account, kind: kind || 'apikey' };
  }
  return null;
}

/** Tenant namespace: org-wide, else account-wide, else per user; platform
 *  callers (internal, no principal) must name the tenant explicitly. */
export function tenantFor(req: express.Request): string | null {
  const p = principalFromHeaders(req);
  if (p) {
    if (p.org) return `org:${p.org}`;
    if (p.account) return `account:${p.account}`;
    return `user:${p.sub}`;
  }
  if (header(req, 'x-synapsedx-anon') === '1') return null;
  const raw = header(req, 'x-synapsedx-tenant') || String(req.query.tenant || '');
  if (!raw || raw.length > 128 || /[\r\n\x00-\x1F\x7F]/.test(raw)) return null;
  return `tenant:${raw}`;
}

/** Physical prefix for a tenant: S3-key safe and injective (':' → '_',
 *  every other non [A-Za-z0-9.-] char — including '_' and '~' — → ~hex~). */
export function tenantPrefix(tenant: string): string {
  return tenant.replace(/[^A-Za-z0-9.-]/g, (c) => (c === ':' ? '_' : `~${c.charCodeAt(0).toString(16)}~`));
}

class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

export function cleanKey(raw: unknown): string {
  const k = String(raw ?? '');
  if (!k || k.length > MAX_KEY_LENGTH) throw new RequestError(400, 'invalid_key', `object key must be 1..${MAX_KEY_LENGTH} chars`);
  if (/[\x00-\x1F\x7F\\]/.test(k) || k.startsWith('/') || k.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new RequestError(400, 'invalid_key', 'object key must not contain control chars, backslashes, leading "/" or "."/".." segments');
  }
  return k;
}

function cleanBucket(raw: unknown): string {
  const b = String(raw ?? '');
  if (!BUCKET_RE.test(b)) throw new RequestError(400, 'invalid_bucket', 'bucket must be 3..63 chars of a-z, 0-9 and "-" (no leading/trailing "-")');
  return b;
}

function cleanContentType(raw: unknown): string {
  const ct = String(raw || '').trim();
  if (!ct) return 'application/octet-stream';
  if (ct.length > 200 || !CONTENT_TYPE_RE.test(ct)) throw new RequestError(400, 'invalid_content_type', 'Content-Type is malformed');
  return ct;
}

// ---------- signed links ----------

interface SignedClaims {
  v: 1;
  t: string; // tenant
  b: string; // bucket
  k: string; // key
  m: 'GET' | 'PUT';
  e: number; // expiry (epoch seconds)
  ct?: string; // PUT: required content type
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(claims: SignedClaims, secret: string): string {
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): SignedClaims | null {
  if (!token || token.length > 4096) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(b64url(createHmac('sha256', secret).update(payload).digest()));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignedClaims;
    if (c.v !== 1 || (c.m !== 'GET' && c.m !== 'PUT') || typeof c.e !== 'number' || c.e * 1000 < now) return null;
    return c;
  } catch {
    return null;
  }
}

// ---------- app ----------

interface BucketConfig {
  name: string;
  visibility: 'private';
  maxObjectBytes: number;
  createdAt: string;
  createdBy: string | null;
}

export function createApp(backend: ObjectBackend = backendFromEnv()): express.Express {
  const INTERNAL_SECRET = process.env.SYNAPSEDX_INTERNAL_SECRET || '';
  const SIGNING_SECRET = process.env.STORAGE_SIGNING_SECRET || INTERNAL_SECRET || 'dev_storage_signing_secret_change_me';
  const PUBLIC_BASE = (process.env.STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (IS_PROD) {
    if (!INTERNAL_SECRET) throw new Error('[storage] SYNAPSEDX_INTERNAL_SECRET must be set in production');
    if (backend.kind === 'memory') throw new Error('[storage] S3_ENDPOINT must be set in production (in-memory fallback would lose data)');
    if (SIGNING_SECRET.length < 32) throw new Error('[storage] STORAGE_SIGNING_SECRET (or the internal secret) must be ≥32 chars in production');
  } else if (!INTERNAL_SECRET) {
    console.warn('[storage][security] SYNAPSEDX_INTERNAL_SECRET not set — service-to-service auth disabled (dev default).');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if ((process.env.HSTS_ENABLED || 'false') === 'true') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  app.use(cors((() => {
    const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!origins.length) return IS_PROD ? ({ origin: false } as any) : undefined;
    return { origin: origins } as any;
  })()));
  app.use(morgan(':method :url :status :response-time ms rid=:req[x-request-id]'));
  app.use(((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const incoming = String(req.headers['x-request-id'] || '').replace(/[^A-Za-z0-9._~-]/g, '').slice(0, 128);
    const id = incoming || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    (req.headers as any)['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  }) as any);

  // ---- metrics (bounded cardinality) ----
  const counters = new Map<string, number>();
  let bytesIn = 0;
  let bytesOut = 0;
  app.use(((req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.on('finish', () => {
      const route = String(req.route?.path || '/').slice(0, 64);
      const key = `${req.method}|${counters.size >= 200 ? '**' : route}|${res.statusCode}`;
      counters.set(key, (counters.get(key) || 0) + 1);
    });
    next();
  }) as any);
  app.get('/metrics', (_req, res) => {
    const lines = [
      '# HELP synapsedx_storage_up Synapse Storage service up.',
      '# TYPE synapsedx_storage_up gauge',
      'synapsedx_storage_up 1',
      '# HELP synapsedx_storage_backend_info Active backend (1 = active).',
      '# TYPE synapsedx_storage_backend_info gauge',
      `synapsedx_storage_backend_info{backend="${backend.kind}"} 1`,
      '# HELP synapsedx_storage_bytes_in_total Bytes uploaded.',
      '# TYPE synapsedx_storage_bytes_in_total counter',
      `synapsedx_storage_bytes_in_total ${bytesIn}`,
      '# HELP synapsedx_storage_bytes_out_total Bytes downloaded (object size served).',
      '# TYPE synapsedx_storage_bytes_out_total counter',
      `synapsedx_storage_bytes_out_total ${bytesOut}`,
      '# HELP synapsedx_storage_http_requests_total HTTP requests by key = method|route|status.',
      '# TYPE synapsedx_storage_http_requests_total counter',
      ...[...counters.entries()].map(([k, v]) => `synapsedx_storage_http_requests_total{key="${k}"} ${v}`),
    ];
    res.type('text/plain').send(`${lines.join('\n')}\n`);
  });

  // ---- internal secret gate ----
  app.use('/v1/' as any, ((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!INTERNAL_SECRET) {
      if (IS_PROD) return res.status(500).json({ error: 'misconfigured', message: 'internal secret required in production' });
      return next();
    }
    const got = header(req, 'x-synapsedx-internal');
    const a = Buffer.from(got);
    const b = Buffer.from(INTERNAL_SECRET);
    if (!got || a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid internal credential' });
    }
    next();
  }) as any);

  // Async wrapper (Express 4 doesn't catch async throws).
  for (const m of ['get', 'post', 'put', 'delete', 'head'] as const) {
    const orig = ((app as any)[m] as Function).bind(app);
    (app as any)[m] = (path: string, ...handlers: any[]) =>
      orig(path, ...handlers.map((h: any) =>
        typeof h === 'function' && h.length < 4
          ? (req: express.Request, res: express.Response, next: express.NextFunction) => Promise.resolve(h(req, res, next)).catch(next)
          : h,
      ));
  }

  const json = express.json({ limit: '64kb' });
  const raw = express.raw({ type: () => true, limit: MAX_OBJECT_BYTES });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'storage', version: VERSION, backend: backend.kind, time: new Date().toISOString() });
  });

  // ---- helpers bound to the backend ----
  const cfgKey = (tenant: string, bucket: string) => `${tenantPrefix(tenant)}/.buckets/${bucket}.json`;
  const objKey = (tenant: string, bucket: string, key: string) => `${tenantPrefix(tenant)}/${bucket}/${key}`;
  const objPrefix = (tenant: string, bucket: string) => `${tenantPrefix(tenant)}/${bucket}/`;

  async function readBucket(tenant: string, bucket: string): Promise<BucketConfig | null> {
    const got = await backend.get(cfgKey(tenant, bucket));
    if (!got) return null;
    const chunks: Buffer[] = [];
    for await (const c of got.body) chunks.push(Buffer.from(c));
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BucketConfig;
    } catch {
      return null;
    }
  }

  function requireTenant(req: express.Request): string {
    const t = tenantFor(req);
    if (t) return t;
    if (header(req, 'x-synapsedx-anon') === '1') throw new RequestError(401, 'unauthorized', 'authentication required');
    throw new RequestError(400, 'tenant_required', 'platform callers must pass x-synapsedx-tenant or ?tenant=');
  }

  async function requireBucket(tenant: string, rawBucket: unknown): Promise<BucketConfig> {
    const bucket = cleanBucket(rawBucket);
    const cfg = await readBucket(tenant, bucket);
    if (!cfg) throw new RequestError(404, 'bucket_not_found', `bucket '${bucket}' does not exist`);
    return cfg;
  }

  function publicObject(info: ObjectInfo, bucket: string, key: string) {
    return { bucket, key, size: info.size, etag: info.etag, contentType: info.contentType, lastModified: info.lastModified };
  }

  async function storeObject(tenant: string, cfg: BucketConfig, key: string, req: express.Request, uploadedBy: string | null, requiredType?: string) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length > cfg.maxObjectBytes) {
      throw new RequestError(413, 'object_too_large', `object exceeds the bucket limit of ${cfg.maxObjectBytes} bytes`);
    }
    const contentType = cleanContentType(req.headers['content-type']);
    if (requiredType && contentType.split(';')[0].trim().toLowerCase() !== requiredType.toLowerCase()) {
      throw new RequestError(400, 'content_type_mismatch', `signed upload requires Content-Type ${requiredType}`);
    }
    const info = await backend.put(objKey(tenant, cfg.name, key), body, contentType, uploadedBy ? { 'uploaded-by': uploadedBy.slice(0, 128) } : {});
    bytesIn += body.length;
    return publicObject(info, cfg.name, key);
  }

  async function sendObject(req: express.Request, res: express.Response, tenant: string, bucket: string, key: string) {
    const headOnly = req.method === 'HEAD';
    const found = headOnly ? await backend.head(objKey(tenant, bucket, key)) : null;
    const got = headOnly ? (found ? { info: found, body: null } : null) : await backend.get(objKey(tenant, bucket, key));
    if (!got) throw new RequestError(404, 'object_not_found', `object '${key}' does not exist`);
    const { info } = got;
    const etag = `"${info.etag}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', new Date(info.lastModified).toUTCString());
    res.setHeader('Content-Type', info.contentType);
    res.setHeader('Content-Length', String(info.size));
    res.setHeader('Cache-Control', 'private, max-age=0');
    // Never let an uploaded file run as active content on the API origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const filename = (key.split('/').pop() || 'object').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
    const disp = INLINE_TYPES.test(info.contentType.split(';')[0].trim()) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disp}; filename="${filename}"`);
    if (header(req, 'if-none-match') === etag) {
      (got.body as any)?.destroy?.();
      return res.status(304).end();
    }
    if (headOnly || !got.body) return res.status(200).end();
    bytesOut += info.size;
    got.body.on('error', () => res.destroy());
    got.body.pipe(res);
  }

  function signedUrl(token: string): { path: string; url: string } {
    const path = `/v1/storage/signed/${token}`;
    return { path, url: PUBLIC_BASE ? `${PUBLIC_BASE}${path}` : path };
  }

  function expiresInOrThrow(v: unknown): number {
    if (v === undefined || v === null) return 900;
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > MAX_SIGNED_TTL) {
      throw new RequestError(400, 'invalid_expires', `expiresIn must be an integer 1..${MAX_SIGNED_TTL} seconds`);
    }
    return v as number;
  }

  // ---- stats ----
  app.get('/v1/storage/stats', async (req, res) => {
    const tenant = requireTenant(req);
    const buckets = await backend.list(`${tenantPrefix(tenant)}/.buckets/`, { limit: MAX_BUCKETS_PER_TENANT });
    res.json({ backend: backend.kind, buckets: buckets.items.length, maxObjectBytes: MAX_OBJECT_BYTES, maxBuckets: MAX_BUCKETS_PER_TENANT });
  });

  // ---- buckets ----
  app.get('/v1/storage/buckets', async (req, res) => {
    const tenant = requireTenant(req);
    const listed = await backend.list(`${tenantPrefix(tenant)}/.buckets/`, { limit: MAX_BUCKETS_PER_TENANT });
    const out: BucketConfig[] = [];
    for (const item of listed.items) {
      const name = item.key.split('/').pop()!.replace(/\.json$/, '');
      const cfg = await readBucket(tenant, name);
      if (cfg) out.push(cfg);
    }
    res.json(out.sort((a, b) => a.name.localeCompare(b.name)));
  });

  app.post('/v1/storage/buckets', json, async (req, res) => {
    const tenant = requireTenant(req);
    const body = (req.body || {}) as any;
    const name = cleanBucket(body.name);
    let max = MAX_OBJECT_BYTES;
    if (body.maxObjectBytes != null) {
      if (!Number.isInteger(body.maxObjectBytes) || body.maxObjectBytes < 1 || body.maxObjectBytes > MAX_OBJECT_BYTES) {
        throw new RequestError(400, 'invalid_max_object_bytes', `maxObjectBytes must be an integer 1..${MAX_OBJECT_BYTES}`);
      }
      max = body.maxObjectBytes;
    }
    if (body.visibility != null && body.visibility !== 'private') {
      throw new RequestError(400, 'invalid_visibility', "only 'private' buckets are supported; share objects with signed links");
    }
    if (await readBucket(tenant, name)) throw new RequestError(409, 'bucket_exists', `bucket '${name}' already exists`);
    const count = (await backend.list(`${tenantPrefix(tenant)}/.buckets/`, { limit: MAX_BUCKETS_PER_TENANT })).items.length;
    if (count >= MAX_BUCKETS_PER_TENANT) throw new RequestError(409, 'bucket_limit', `tenant bucket limit (${MAX_BUCKETS_PER_TENANT}) reached`);
    const cfg: BucketConfig = {
      name, visibility: 'private', maxObjectBytes: max, createdAt: new Date().toISOString(),
      createdBy: principalFromHeaders(req)?.sub || null,
    };
    await backend.put(cfgKey(tenant, name), Buffer.from(JSON.stringify(cfg)), 'application/json', {});
    res.status(201).json(cfg);
  });

  app.get('/v1/storage/buckets/:bucket', async (req, res) => {
    const tenant = requireTenant(req);
    res.json(await requireBucket(tenant, req.params.bucket));
  });

  app.delete('/v1/storage/buckets/:bucket', async (req, res) => {
    const tenant = requireTenant(req);
    const cfg = await requireBucket(tenant, req.params.bucket);
    const force = String(req.query.force || '') === 'true';
    const prefix = objPrefix(tenant, cfg.name);
    let removed = 0;
    for (let round = 0; round < 50; round++) {
      const page = await backend.list(prefix, { limit: 200 });
      if (!page.items.length) break;
      if (!force) throw new RequestError(409, 'bucket_not_empty', 'bucket is not empty (pass ?force=true to delete its objects)');
      for (const it of page.items) if (await backend.delete(it.key)) removed++;
    }
    await backend.delete(cfgKey(tenant, cfg.name));
    res.json({ deleted: true, bucket: cfg.name, objectsDeleted: removed });
  });

  // ---- objects ----
  app.get('/v1/storage/buckets/:bucket/objects', async (req, res) => {
    const tenant = requireTenant(req);
    const cfg = await requireBucket(tenant, req.params.bucket);
    const prefixRel = String(req.query.prefix || '');
    if (prefixRel) cleanKey(prefixRel);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const delimiter = req.query.delimiter === '/' ? '/' : undefined;
    const base = objPrefix(tenant, cfg.name);
    const cursorRel = String(req.query.cursor || '');
    const page = await backend.list(base + prefixRel, { limit, delimiter, cursor: cursorRel ? base + cleanKey(cursorRel) : undefined });
    res.json({
      bucket: cfg.name,
      items: page.items.map((i) => ({ key: i.key.slice(base.length), size: i.size, etag: i.etag, lastModified: i.lastModified })),
      prefixes: page.prefixes.map((p) => p.slice(base.length)),
      nextCursor: page.nextCursor ? page.nextCursor.slice(base.length) : null,
    });
  });

  app.put('/v1/storage/buckets/:bucket/objects/*', raw, async (req, res) => {
    const tenant = requireTenant(req);
    const cfg = await requireBucket(tenant, req.params.bucket);
    const key = cleanKey((req.params as any)[0]);
    res.status(201).json(await storeObject(tenant, cfg, key, req, principalFromHeaders(req)?.sub || null));
  });

  const download = async (req: express.Request, res: express.Response) => {
    const tenant = requireTenant(req);
    const cfg = await requireBucket(tenant, req.params.bucket);
    await sendObject(req, res, tenant, cfg.name, cleanKey((req.params as any)[0]));
  };
  app.get('/v1/storage/buckets/:bucket/objects/*', download);
  app.head('/v1/storage/buckets/:bucket/objects/*', download);

  app.delete('/v1/storage/buckets/:bucket/objects/*', async (req, res) => {
    const tenant = requireTenant(req);
    const cfg = await requireBucket(tenant, req.params.bucket);
    const key = cleanKey((req.params as any)[0]);
    const ok = await backend.delete(objKey(tenant, cfg.name, key));
    if (!ok) throw new RequestError(404, 'object_not_found', `object '${key}' does not exist`);
    res.json({ deleted: true, bucket: cfg.name, key });
  });

  // ---- signed links ----
  app.post('/v1/storage/buckets/:bucket/presign-download', json, async (req, res) => {
    const tenant = requireTenant(req);
    const cfg = await requireBucket(tenant, req.params.bucket);
    const key = cleanKey((req.body || {}).key);
    if (!(await backend.head(objKey(tenant, cfg.name, key)))) throw new RequestError(404, 'object_not_found', `object '${key}' does not exist`);
    const ttl = expiresInOrThrow((req.body || {}).expiresIn);
    const e = Math.floor(Date.now() / 1000) + ttl;
    const token = signToken({ v: 1, t: tenant, b: cfg.name, k: key, m: 'GET', e }, SIGNING_SECRET);
    res.status(201).json({ method: 'GET', bucket: cfg.name, key, expiresAt: new Date(e * 1000).toISOString(), ...signedUrl(token) });
  });

  app.post('/v1/storage/buckets/:bucket/presign-upload', json, async (req, res) => {
    const tenant = requireTenant(req);
    const cfg = await requireBucket(tenant, req.params.bucket);
    const body = (req.body || {}) as any;
    const key = cleanKey(body.key);
    const ct = cleanContentType(body.contentType).split(';')[0].trim();
    const ttl = expiresInOrThrow(body.expiresIn);
    const e = Math.floor(Date.now() / 1000) + ttl;
    const token = signToken({ v: 1, t: tenant, b: cfg.name, k: key, m: 'PUT', e, ct }, SIGNING_SECRET);
    res.status(201).json({
      method: 'PUT', bucket: cfg.name, key, contentType: ct, maxBytes: cfg.maxObjectBytes,
      expiresAt: new Date(e * 1000).toISOString(), ...signedUrl(token),
    });
  });

  async function signedClaims(req: express.Request, method: 'GET' | 'PUT'): Promise<{ claims: SignedClaims; cfg: BucketConfig }> {
    const claims = verifyToken(String(req.params.token || ''), SIGNING_SECRET);
    if (!claims || claims.m !== method) throw new RequestError(403, 'invalid_signature', 'signed link is invalid, expired or not valid for this method');
    const cfg = await readBucket(claims.t, claims.b);
    if (!cfg) throw new RequestError(404, 'bucket_not_found', 'bucket no longer exists');
    return { claims, cfg };
  }

  const signedDownload = async (req: express.Request, res: express.Response) => {
    const { claims, cfg } = await signedClaims(req, 'GET');
    await sendObject(req, res, claims.t, cfg.name, claims.k);
  };
  app.get('/v1/storage/signed/:token', signedDownload);
  app.head('/v1/storage/signed/:token', signedDownload);

  app.put('/v1/storage/signed/:token', raw, async (req, res) => {
    const { claims, cfg } = await signedClaims(req, 'PUT');
    res.status(201).json(await storeObject(claims.t, cfg, claims.k, req, 'signed-link', claims.ct));
  });

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return res.destroy();
    if (err instanceof RequestError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({ error: 'object_too_large', message: `request body exceeds ${MAX_OBJECT_BYTES} bytes` });
    }
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
    }
    console.error('[storage] unhandled:', err?.message || err);
    res.status(502).json({ error: 'storage_backend_error', message: 'object backend request failed' });
  });
  return app;
}

if (require.main === module) {
  const backend = backendFromEnv();
  const app = createApp(backend);
  const server = app.listen(PORT, () => console.log(`[storage] listening on :${PORT} backend=${backend.kind}`));
  const shutdown = () => {
    console.log('[storage] shutting down...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
