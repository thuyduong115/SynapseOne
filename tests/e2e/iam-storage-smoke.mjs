/*
 * Copyright 2026 SynapseDX Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Docker-free integration smoke for AWS-style access management + object
 * storage: boots the real gateway, IAM and storage processes (in-memory
 * backends, internal secret on, AUTHZ_MODE=enforce) and walks the flow
 * org admin → member → managed policy → scoped/owner-bound keys → rotation
 * → signed links → audit.
 *
 * Usage (after `npm run build --workspaces`): node tests/e2e/iam-storage-smoke.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = 'smoke-internal-secret-0123456789abcdef';
const JWT = 'smoke-jwt-secret-0123456789abcdef-0123456789';
const common = { ...process.env, SYNAPSEDX_INTERNAL_SECRET: SECRET, IAM_JWT_SECRET: JWT, USAGE_TELEMETRY: 'false' };
delete common.DATABASE_URL;
delete common.S3_ENDPOINT;
const procs = [];
function start(name, dir, port, extra = {}) {
  const p = spawn(process.execPath, ['dist/index.js'], {
    cwd: path.join(ROOT, dir),
    env: { ...common, PORT: String(port), ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', (d) => { if (/error/i.test(String(d))) process.stderr.write(`[${name}] ${d}`); });
  procs.push(p);
}
start('iam', 'apps/iam-service', 14001, { IAM_ALLOW_DEV_LOGIN: 'true' });
start('storage', 'apps/storage-service', 14010);
start('gateway', 'apps/gateway', 18080, {
  IAM_SERVICE_URL: 'http://127.0.0.1:14001',
  STORAGE_SERVICE_URL: 'http://127.0.0.1:14010',
  AUTHZ_MODE: 'enforce',
  AUTHZ_CACHE_TTL_MS: '0',
  GATEWAY_ROUTES_PATH: path.join(ROOT, 'apps/gateway/routes.yaml'),
});

const GW = 'http://127.0.0.1:18080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, { token, key, body, raw, type } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (key) h['X-API-Key'] = key;
  if (raw !== undefined) h['Content-Type'] = type || 'application/octet-stream';
  else if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(GW + p, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary */ }
  return { status: r.status, json, text, headers: r.headers };
}
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra ? `  -> ${extra}` : ''}`);
  if (!cond) failures++;
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      const ups = await Promise.all(['http://127.0.0.1:14001', 'http://127.0.0.1:14010', GW].map((u) => fetch(u + '/health').then((r) => r.ok, () => false)));
      if (ups.every(Boolean)) break;
    } catch { /* booting */ }
    await sleep(250);
  }
  await sleep(500);

  // Org admin (first user) and a member (later user, no permissions).
  const admin = await call('POST', '/v1/auth/login', { body: { email: 'admin@city.local', orgSlug: 'smokecity' } });
  if (!admin.json?.user) throw new Error(`login failed: ${admin.status} ${admin.text.slice(0, 300)}`);
  const A = admin.json.accessToken;
  const orgId = admin.json.user.org_id;
  check('first user is org admin', admin.json.user.is_org_admin === true);
  const member = await call('POST', '/v1/auth/login', { body: { email: 'staff@city.local', orgSlug: 'smokecity' } });
  const M = member.json.accessToken;
  const memberId = member.json.user.id;
  check('second user is not admin', member.json.user.is_org_admin === false);

  const acc = await call('POST', `/v1/orgs/${orgId}/accounts`, { token: A, body: { slug: 'ops', displayName: 'Operations' } });
  check('admin creates account (iam:Write)', acc.status === 201, JSON.stringify(acc.json));
  const accId = acc.json.id;

  // Member is denied by central enforcement (no roles yet).
  const denied = await call('GET', '/v1/storage/buckets', { token: M });
  check('member without roles → 403 access_denied', denied.status === 403 && denied.json?.error === 'access_denied', JSON.stringify(denied.json));
  check('denial names action + reason', denied.json?.action === 'storage:Read' && denied.json?.reason === 'implicit-deny');
  const memberIam = await call('POST', `/v1/orgs/${orgId}/accounts`, { token: M, body: { slug: 'evil', displayName: 'Evil' } });
  check('member cannot create accounts (iam:Write denied)', memberIam.status === 403);

  // Admin stores a document.
  check('admin creates bucket', (await call('POST', '/v1/storage/buckets', { token: A, body: { name: 'documents' } })).status === 201);
  const pdf = Buffer.from('%PDF-1.4 smoke');
  const put = await call('PUT', '/v1/storage/buckets/documents/objects/reports/q3.pdf', { token: A, raw: pdf, type: 'application/pdf' });
  check('admin uploads object through gateway', put.status === 201 && put.json.size === pdf.length, JSON.stringify(put.json));

  // Grant member StorageReadOnlyAccess via a managed policy.
  const role = await call('POST', `/v1/accounts/${accId}/roles`, { token: A, body: { slug: 'doc-readers' } });
  const pol = await call('POST', `/v1/accounts/${accId}/policies`, { token: A, body: { slug: 'storage-ro', managed: 'StorageReadOnlyAccess' } });
  await call('POST', `/v1/roles/${role.json.id}/attach`, { token: A, body: { policyId: pol.json.id } });
  await call('POST', `/v1/users/${memberId}/assign`, { token: A, body: { roleId: role.json.id } });
  const read = await call('GET', '/v1/storage/buckets/documents/objects/reports/q3.pdf', { token: M });
  check('member with StorageReadOnlyAccess can download', read.status === 200 && read.text === pdf.toString(), `${read.status}`);
  const write = await call('PUT', '/v1/storage/buckets/documents/objects/x.txt', { token: M, raw: 'x', type: 'text/plain' });
  check('…but cannot upload (storage:Write denied)', write.status === 403 && write.json?.action === 'storage:Write');
  const presignUp = await call('POST', '/v1/storage/buckets/documents/presign-upload', { token: M, body: { key: 'x.txt' } });
  check('…and cannot mint upload links (presign-upload → storage:Write)', presignUp.status === 403);
  const presignDl = await call('POST', '/v1/storage/buckets/documents/presign-download', { token: M, body: { key: 'reports/q3.pdf' } });
  check('…but can mint download links', presignDl.status === 201, JSON.stringify(presignDl.json));
  const anon = await call('GET', presignDl.json.path);
  check('signed link works with no credentials', anon.status === 200 && anon.text === pdf.toString(), `${anon.status} ${anon.text.slice(0, 80)}`);

  // Scoped, owner-bound API key: scopes cap the owner's permissions.
  const k = await call('POST', `/v1/accounts/${accId}/keys`, { token: A, body: { name: 'etl', scopes: ['storage:*'], userId: memberId } });
  check('admin issues owner-bound scoped key', k.status === 201);
  // API keys live in their account's tenant namespace (existing contract).
  const ak = await call('POST', `/v1/accounts/${accId}/keys`, { token: A, body: { name: 'ops-admin', scopes: ['storage:*'], userId: admin.json.user.id } });
  check('admin-owned key creates an account bucket', (await call('POST', '/v1/storage/buckets', { key: ak.json.apiKey, body: { name: 'keydocs' } })).status === 201);
  check('admin-owned key uploads', (await call('PUT', '/v1/storage/buckets/keydocs/objects/a.txt', { key: ak.json.apiKey, raw: 'hello', type: 'text/plain' })).status === 201);
  const kRead = await call('GET', '/v1/storage/buckets/keydocs/objects/a.txt', { key: k.json.apiKey });
  check('member-owned key reads (scope ∩ owner ReadOnly)', kRead.status === 200 && kRead.text === 'hello', `${kRead.status} ${kRead.text.slice(0, 120)}`);
  const kWrite = await call('PUT', '/v1/storage/buckets/keydocs/objects/y.txt', { key: k.json.apiKey, raw: 'y', type: 'text/plain' });
  check('key cannot write (owner lacks storage:Write)', kWrite.status === 403 && kWrite.json?.reason === 'implicit-deny');
  const kIam = await call('GET', `/v1/orgs/${orgId}/accounts`, { key: k.json.apiKey });
  check('key cannot call IAM (scope-deny)', kIam.status === 403 && kIam.json?.reason === 'scope-deny', JSON.stringify(kIam.json));

  // Rotation: old key dies, new key works.
  const rot = await call('POST', `/v1/keys/${k.json.id}/rotate`, { token: A, body: {} });
  check('admin rotates key', rot.status === 201);
  check('old key rejected after rotation', (await call('GET', '/v1/storage/buckets', { key: k.json.apiKey })).status === 401);
  check('new key works', (await call('GET', '/v1/storage/buckets', { key: rot.json.apiKey })).status === 200);

  // Audit shows gateway denials to the org admin.
  const audit = await call('GET', '/v1/audit?allowed=false&limit=200', { token: A });
  check('denials are audited for the org', Array.isArray(audit.json) && audit.json.some((e) => e.action === 'storage:Write' && e.context?.enforcement === 'gateway'), JSON.stringify(audit.json).slice(0, 200));

  // Sessions.
  const sessions = await call('GET', '/v1/auth/sessions', { token: M });
  check('member lists own sessions', sessions.status === 200 && sessions.json.length >= 1);
  const ready = await call('GET', '/ready');
  check('/ready probes storage', JSON.stringify(ready.json).includes('"storage"'));
} catch (e) {
  console.error('smoke crashed:', e);
  failures++;
} finally {
  for (const p of procs) p.kill();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
