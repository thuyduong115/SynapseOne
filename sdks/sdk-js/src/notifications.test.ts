// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Notifications SDK tests (stub gateway).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SynapseOneClient } from './index';

let server: http.Server;
let base = '';
let last: { method?: string; path?: string; body?: any } = {};

before(
  () =>
    new Promise<void>((resolve) => {
      server = http
        .createServer((req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            last = { method: req.method, path: req.url, body: body ? JSON.parse(body) : null };
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/v1/notifications' && req.method === 'POST') {
              res.statusCode = 202;
              res.end(JSON.stringify({ notifications: [{ id: 'n1', status: 'queued' }] }));
              return;
            }
            res.end(JSON.stringify({ id: 'n1', status: 'delivered', unsubscribed: false, channels: [] }));
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

describe('SynapseNotifications SDK', () => {
  it('sends a templated notification', async () => {
    const c = new SynapseOneClient({ baseUrl: base });
    const out = await c.notifications.send({
      channel: 'webhook',
      recipient: { url: 'https://example.com/hook' },
      subject: 'Hi {{name}}',
      body: 'Hello {{name}}',
      data: { name: 'An' },
    });
    assert.equal(out.notifications[0].id, 'n1');
    assert.equal(last.path, '/v1/notifications');
    assert.equal(last.body.subject, 'Hi {{name}}');
    assert.equal(last.body.recipient.url, 'https://example.com/hook');
  });

  it('gets, lists, cancels, preferences and unsubscribe', async () => {
    const c = new SynapseOneClient({ baseUrl: base });
    await c.notifications.get('n1');
    assert.equal(last.path, '/v1/notifications/n1');
    await c.notifications.list({ status: 'queued', limit: 5 });
    assert.equal(last.path, '/v1/notifications?status=queued&limit=5');
    await c.notifications.cancel('n1');
    assert.equal(last.path, '/v1/notifications/n1/cancel');
    await c.notifications.getPreference('user:u1');
    assert.equal(last.path, '/v1/notifications/preferences/user%3Au1');
    await c.notifications.setPreference('user:u1', { channels: ['email'], unsubscribed: false });
    assert.deepEqual(last.body, { channels: ['email'], unsubscribed: false });
    await c.notifications.unsubscribe('user:u1');
    assert.deepEqual(last.body, { recipient: 'user:u1' });
  });
});
