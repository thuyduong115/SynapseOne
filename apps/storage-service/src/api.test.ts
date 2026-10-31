/*
 * Copyright 2026 SynapseDX Contributors
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Synapse Storage API: buckets, objects, tenant isolation, signed links and
 * input hardening. Runs on the in-memory backend.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp, cleanKey, signToken, verifyToken, tenantPrefix } from './index';
import { MemoryBackend } from './store';

const SECRET = 'storage-test-internal-secret-0123456789';

describe('storage api', () => {
  let base = '';
  let server: Server | null = null;
  const saved: Record<string, string | undefined> = {};

  const orgA = { 'x-synapsedx-user': 'u-a', 'x-synapsedx-org': 'org-a', 'x-synapsedx-kind': 'user' };
  const orgB = { 'x-synapsedx-user': 'u-b', 'x-synapsedx-org': 'org-b', 'x-synapsedx-kind': 'user' };

  async function call(method: string, path: string, opts: { who?: Record<string, string>; body?: any; raw?: Buffer | string; type?: string; internal?: boolean } = {}) {
    const headers: Record<string, string> = { ...(opts.who || {}) };
    if (opts.internal !== false) headers['x-synapsedx-internal'] = SECRET;
    let body: any;
    if (opts.raw !== undefined) {
      body = opts.raw;
      if (opts.type) headers['Content-Type'] = opts.type;
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(base + path, { method, headers, body });
    const buf = Buffer.from(await r.arrayBuffer());
    let json: any = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ }
    return { status: r.status, headers: r.headers, buf, json };
  }

  before(
    () =>
      new Promise<void>((resolve) => {
        for (const k of ['SYNAPSEDX_INTERNAL_SECRET', 'NODE_ENV', 'STORAGE_SIGNING_SECRET']) saved[k] = process.env[k];
        process.env.SYNAPSEDX_INTERNAL_SECRET = SECRET;
        delete process.env.NODE_ENV;
        delete process.env.STORAGE_SIGNING_SECRET;
        const app = createApp(new MemoryBackend());
        server = app.listen(0, '127.0.0.1', () => {
          const a = server!.address();
          base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
          resolve();
        });
      }),
  );
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    server?.close();
  });

  it('requires the internal secret and a principal', async () => {
    assert.equal((await call('GET', '/v1/storage/buckets', { who: orgA, internal: false })).status, 401);
    assert.equal((await call('GET', '/v1/storage/buckets', { who: { 'x-synapsedx-anon': '1' } })).status, 401);
    assert.equal((await call('GET', '/v1/storage/buckets')).json.error, 'tenant_required');
    assert.equal((await call('GET', '/health', { internal: false })).json.backend, 'memory');
  });

  it('bucket lifecycle with validation', async () => {
    assert.equal((await call('POST', '/v1/storage/buckets', { who: orgA, body: { name: 'Bad_Name' } })).status, 400);
    assert.equal((await call('POST', '/v1/storage/buckets', { who: orgA, body: { name: 'docs', visibility: 'public' } })).status, 400);
    const created = await call('POST', '/v1/storage/buckets', { who: orgA, body: { name: 'docs', maxObjectBytes: 64 } });
    assert.equal(created.status, 201);
    assert.equal(created.json.createdBy, 'u-a');
    assert.equal((await call('POST', '/v1/storage/buckets', { who: orgA, body: { name: 'docs' } })).status, 409);
    const list = await call('GET', '/v1/storage/buckets', { who: orgA });
    assert.deepEqual(list.json.map((b: any) => b.name), ['docs']);
  });

  it('stores and serves objects byte-for-byte with metadata headers', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 10, 13]);
    const put = await call('PUT', '/v1/storage/buckets/docs/objects/reports/2026/q3.bin', { who: orgA, raw: bytes, type: 'application/octet-stream' });
    assert.equal(put.status, 201);
    assert.equal(put.json.size, bytes.length);
    const got = await call('GET', '/v1/storage/buckets/docs/objects/reports/2026/q3.bin', { who: orgA });
    assert.equal(got.status, 200);
    assert.deepEqual(got.buf, bytes);
    assert.equal(got.headers.get('etag'), `"${put.json.etag}"`);
    assert.match(got.headers.get('content-disposition') || '', /^attachment; filename="q3.bin"/);
    assert.match(got.headers.get('content-security-policy') || '', /sandbox/);
    const head = await call('HEAD', '/v1/storage/buckets/docs/objects/reports/2026/q3.bin', { who: orgA });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    const notModified = await call('GET', '/v1/storage/buckets/docs/objects/reports/2026/q3.bin', { who: { ...orgA, 'if-none-match': `"${put.json.etag}"` } });
    assert.equal(notModified.status, 304);
  });

  it('never serves uploads as active content', async () => {
    await call('PUT', '/v1/storage/buckets/docs/objects/x.html', { who: orgA, raw: '<script>1</script>', type: 'text/html' });
    const got = await call('GET', '/v1/storage/buckets/docs/objects/x.html', { who: orgA });
    assert.match(got.headers.get('content-disposition') || '', /^attachment/);
    await call('PUT', '/v1/storage/buckets/docs/objects/pic.png', { who: orgA, raw: Buffer.from('png'), type: 'image/png' });
    const png = await call('GET', '/v1/storage/buckets/docs/objects/pic.png', { who: orgA });
    assert.match(png.headers.get('content-disposition') || '', /^inline/);
  });

  it('lists with prefix, delimiter and cursor', async () => {
    await call('PUT', '/v1/storage/buckets/docs/objects/reports/2026/q4.bin', { who: orgA, raw: 'q4' });
    const all = await call('GET', '/v1/storage/buckets/docs/objects?prefix=reports/', { who: orgA });
    assert.deepEqual(all.json.items.map((i: any) => i.key), ['reports/2026/q3.bin', 'reports/2026/q4.bin']);
    const top = await call('GET', '/v1/storage/buckets/docs/objects?delimiter=/', { who: orgA });
    assert.deepEqual(top.json.prefixes, ['reports/']);
    assert.ok(top.json.items.some((i: any) => i.key === 'pic.png'));
    const page = await call('GET', '/v1/storage/buckets/docs/objects?prefix=reports/&limit=1', { who: orgA });
    assert.equal(page.json.items.length, 1);
    const next = await call('GET', `/v1/storage/buckets/docs/objects?prefix=reports/&limit=1&cursor=${encodeURIComponent(page.json.nextCursor)}`, { who: orgA });
    assert.equal(next.json.items[0].key, 'reports/2026/q4.bin');
  });

  it('isolates tenants (same bucket name, different org)', async () => {
    assert.equal((await call('GET', '/v1/storage/buckets/docs/objects/pic.png', { who: orgB })).status, 404);
    assert.equal((await call('POST', '/v1/storage/buckets', { who: orgB, body: { name: 'docs' } })).status, 201);
    assert.equal((await call('GET', '/v1/storage/buckets/docs/objects/pic.png', { who: orgB })).status, 404);
    assert.deepEqual((await call('GET', '/v1/storage/buckets/docs/objects', { who: orgB })).json.items, []);
  });

  it('rejects traversal keys and oversized objects', async () => {
    for (const k of ['../etc/passwd', 'a/../b', './x', 'a\\b']) assert.throws(() => cleanKey(k));
    assert.equal(cleanKey('a/b/c.txt'), 'a/b/c.txt');
    const big = await call('PUT', '/v1/storage/buckets/docs/objects/big.bin', { who: orgA, raw: Buffer.alloc(65) });
    assert.equal(big.status, 413);
    assert.equal((await call('PUT', '/v1/storage/buckets/nope/objects/a.txt', { who: orgA, raw: 'x' })).status, 404);
  });

  it('signed download links work without credentials and expire', async () => {
    const link = await call('POST', '/v1/storage/buckets/docs/presign-download', { who: orgA, body: { key: 'pic.png', expiresIn: 60 } });
    assert.equal(link.status, 201);
    assert.match(link.json.url, /^\/v1\/storage\/signed\//);
    const anon = { 'x-synapsedx-anon': '1' };
    const got = await call('GET', link.json.url, { who: anon });
    assert.equal(got.status, 200);
    assert.equal(got.buf.toString(), 'png');
    // Wrong method / tampered / expired
    assert.equal((await call('PUT', link.json.url, { who: anon, raw: 'x' })).status, 403);
    assert.equal((await call('GET', link.json.url.slice(0, -2) + 'AA', { who: anon })).status, 403);
    const expired = signToken({ v: 1, t: 'org:org-a', b: 'docs', k: 'pic.png', m: 'GET', e: Math.floor(Date.now() / 1000) - 1 }, SECRET);
    assert.equal((await call('GET', `/v1/storage/signed/${expired}`, { who: anon })).status, 403);
    assert.equal((await call('POST', '/v1/storage/buckets/docs/presign-download', { who: orgA, body: { key: 'missing.bin' } })).status, 404);
    assert.equal((await call('POST', '/v1/storage/buckets/docs/presign-download', { who: orgA, body: { key: 'pic.png', expiresIn: 0 } })).status, 400);
  });

  it('signed upload links pin the key and content type', async () => {
    const link = await call('POST', '/v1/storage/buckets/docs/presign-upload', { who: orgA, body: { key: 'inbox/photo.jpg', contentType: 'image/jpeg' } });
    assert.equal(link.status, 201);
    const anon = { 'x-synapsedx-anon': '1' };
    assert.equal((await call('PUT', link.json.url, { who: anon, raw: 'jpg', type: 'text/plain' })).status, 400);
    const up = await call('PUT', link.json.url, { who: anon, raw: 'jpg', type: 'image/jpeg' });
    assert.equal(up.status, 201);
    const got = await call('GET', '/v1/storage/buckets/docs/objects/inbox/photo.jpg', { who: orgA });
    assert.equal(got.buf.toString(), 'jpg');
    assert.equal((await call('GET', link.json.url, { who: anon })).status, 403, 'upload link cannot download');
  });

  it('deletes objects and buckets (non-empty needs force)', async () => {
    assert.equal((await call('DELETE', '/v1/storage/buckets/docs/objects/x.html', { who: orgA })).status, 200);
    assert.equal((await call('DELETE', '/v1/storage/buckets/docs/objects/x.html', { who: orgA })).status, 404);
    assert.equal((await call('DELETE', '/v1/storage/buckets/docs', { who: orgA })).status, 409);
    const forced = await call('DELETE', '/v1/storage/buckets/docs?force=true', { who: orgA });
    assert.equal(forced.status, 200);
    assert.ok(forced.json.objectsDeleted >= 4);
    assert.equal((await call('GET', '/v1/storage/buckets/docs', { who: orgA })).status, 404);
    // org-b's bucket of the same name is untouched
    assert.equal((await call('GET', '/v1/storage/buckets/docs', { who: orgB })).status, 200);
  });

  it('token and prefix helpers', () => {
    const tok = signToken({ v: 1, t: 'org:x', b: 'b1', k: 'k', m: 'GET', e: Math.floor(Date.now() / 1000) + 60 }, 's');
    assert.equal(verifyToken(tok, 's')?.k, 'k');
    assert.equal(verifyToken(tok, 'other'), null);
    assert.equal(tenantPrefix('org:abc-1'), 'org_abc-1');
    assert.notEqual(tenantPrefix('tenant:a/b'), tenantPrefix('tenant:a_b'));
    assert.notEqual(tenantPrefix('tenant:a:b'), tenantPrefix('tenant:a_b'));
    assert.notEqual(tenantPrefix('tenant:a~5f~b'), tenantPrefix('tenant:a_b'));
  });
});
