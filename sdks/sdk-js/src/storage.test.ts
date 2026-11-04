// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Object storage SDK tests: binary upload/download/head/list/multipart.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SynapseOneClient } from './index';

let server: http.Server;
let base = '';
const objects = new Map<string, { body: Buffer; type: string }>();
let lastUploadId = '';

before(
  () =>
    new Promise<void>((resolve) => {
      server = http
        .createServer((req, res) => {
          const url = new URL(req.url || '/', 'http://x');
          const key = decodeURIComponent(url.pathname.replace('/v1/storage/objects/', ''));
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const body = Buffer.concat(chunks);
            if (url.pathname === '/v1/storage/objects' && req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ objects: [{ key: 'a.txt', size: 5, contentType: 'text/plain', etag: 'e', createdAt: 't', updatedAt: 't' }], nextCursor: null }));
              return;
            }
            if (url.pathname === '/v1/storage/presign') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ url: 'https://s3.example.com/x', method: 'GET', expiresIn: 900 }));
              return;
            }
            if (url.pathname === '/v1/storage/uploads') {
              lastUploadId = 'u1';
              res.statusCode = 201;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ uploadId: 'u1', key: 'k', contentType: 'application/octet-stream' }));
              return;
            }
            if (url.pathname.endsWith('/complete')) {
              res.statusCode = 201;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ object: { key: 'k', size: 11, contentType: 'application/octet-stream', etag: 'e', createdAt: 't', updatedAt: 't' } }));
              return;
            }
            if (url.pathname.includes('/parts/')) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ partNumber: 1, etag: 'p1', size: body.length }));
              return;
            }
            if (req.method === 'PUT') {
              objects.set(key, { body, type: String(req.headers['content-type'] || '') });
              res.statusCode = 201;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ object: { key, size: body.length, contentType: req.headers['content-type'], etag: 'e', createdAt: 't', updatedAt: 't' } }));
              return;
            }
            if (req.method === 'HEAD') {
              const o = objects.get(key);
              if (!o) { res.statusCode = 404; res.end(); return; }
              res.setHeader('Content-Type', o.type);
              res.setHeader('Content-Length', String(o.body.length));
              res.setHeader('ETag', '"e"');
              res.setHeader('x-object-key', key);
              res.end();
              return;
            }
            if (req.method === 'GET') {
              const o = objects.get(key);
              if (!o) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"not_found"}'); return; }
              res.setHeader('Content-Type', o.type);
              res.end(o.body);
              return;
            }
            if (req.method === 'DELETE') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: objects.delete(key), key }));
              return;
            }
            res.statusCode = 404;
            res.end('{}');
          });
        })
        .listen(0, '127.0.0.1', () => {
          const a = server.address();
          base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
          resolve();
        });
    }),
);
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('SynapseObjectStorage SDK', () => {
  it('uploads/downloads binary bodies without JSON wrapping', async () => {
    const c = new SynapseOneClient({ baseUrl: base });
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    const meta = await c.storage.putObject('photos/a.png', bytes, { contentType: 'image/png' });
    assert.equal(meta.size, 5);
    const got = await c.storage.getObject('photos/a.png');
    assert.deepEqual([...got], [0, 1, 2, 254, 255]);
  });

  it('reads HEAD metadata and lists objects', async () => {
    const c = new SynapseOneClient({ baseUrl: base });
    await c.storage.putObject('a.txt', 'hello', { contentType: 'text/plain' });
    const head = await c.storage.headObject('a.txt');
    assert.equal(head?.size, 5);
    assert.equal(head?.contentType, 'text/plain');
    assert.equal(await c.storage.headObject('missing'), null);
    const list = await c.storage.listObjects({ prefix: 'a' });
    assert.equal(list.objects[0].key, 'a.txt');
  });

  it('presigns, deletes and runs multipart', async () => {
    const c = new SynapseOneClient({ baseUrl: base });
    const pre = await c.storage.presign('a.txt', { expiresIn: 60 });
    assert.equal(pre.expiresIn, 900); // mock returns its own value
    const del = await c.storage.deleteObject('a.txt');
    assert.equal(typeof del.ok, 'boolean');
    const up = await c.storage.createMultipart('k');
    assert.equal(up.uploadId, 'u1');
    const part = await c.storage.uploadPart(lastUploadId, 'k', 1, new Uint8Array([1, 2, 3]));
    assert.equal(part.etag, 'p1');
    const done = await c.storage.completeMultipart(lastUploadId, 'k', [{ partNumber: 1, etag: 'p1' }]);
    assert.equal(done.object.size, 11);
  });
});
