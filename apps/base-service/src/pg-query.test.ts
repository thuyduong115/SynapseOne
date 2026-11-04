// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License").
 * SynapseBase Postgres pushdown tests (#29).
 *
 * These run only when BASE_TEST_DATABASE_URL points at a disposable Postgres
 * (the normal unit suite has no database). They prove filters/order/pagination
 * execute in Postgres over >10k documents, the full-text GIN index is usable,
 * and tenant scoping still holds on the SQL path.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

const TEST_URL = process.env.BASE_TEST_DATABASE_URL || '';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

describe('postgres query pushdown (#29)', { skip: TEST_URL ? false : 'BASE_TEST_DATABASE_URL not set' }, () => {
  let store: typeof import('./store');
  let query: typeof import('./query');
  let pg: typeof import('./pg-query');
  let server: Server;
  let base = '';
  let collectionId = '';
  let baseHttp = '';

  async function post(path: string, body: any, org = 'qd-tenant-a') {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-synapseone-user': 'query-test-user',
        'x-synapseone-org': org,
        'x-synapseone-kind': 'user',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null, headers: r.headers };
  }

  before(async () => {
    store = await import('./store');
    query = await import('./query');
    pg = await import('./pg-query');
    const appModule = await import('./index');
    await store.ensureTables();
    assert.equal(store.useDb(), true, 'test database must be reachable');

    const col = await store.createCollectionRec({
      name: `qd_${Date.now().toString(36)}`,
      mapping: { fields: {} },
      org_id: 'qd-tenant-a',
    });
    collectionId = col.id;
    baseHttp = col.name;
    await store.pgQuery(
      `INSERT INTO synapseone_base_documents(collection_id, id, data, version)
       SELECT $1,
              'doc-' || lpad(g::text, 6, '0'),
              jsonb_build_object(
                'i', g,
                'category', CASE WHEN g % 2 = 0 THEN 'alpha' ELSE 'beta' END,
                'rare', CASE WHEN g = 1 THEN 'streetlight' ELSE 'ordinary' END,
                'description', CASE WHEN g = 1 THEN 'The streetlight on Main Street is broken' ELSE 'ordinary row' END,
                'location', CASE WHEN g <= 2
                                 THEN jsonb_build_object('lat', 10.7769, 'lng', 106.7009)
                                 ELSE jsonb_build_object('lat', 21.02, 'lng', 105.83) END
              ), 1
         FROM generate_series(1, $2) g`,
      [collectionId, 12_050],
    );
    await store.pgQuery('ANALYZE synapseone_base_documents');
    base = await new Promise<string>((resolve) => {
      server = appModule.createApp().listen(0, '127.0.0.1', () => {
        const a = server.address();
        resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
      });
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (collectionId) await store.deleteCollectionRec(collectionId);
  });

  it('filters and paginates more than 10k documents in Postgres (no 413)', async () => {
    const first = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { category: 'alpha' },
      orderBy: [{ field: 'i', direction: 'asc' }],
      limit: 5,
    });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.total, 6025);
    assert.equal(first.json.items.length, 5);
    assert.equal(first.json.items[0].id, 'doc-000002');
    assert.ok(first.json.nextCursor);

    const second = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { category: 'alpha' },
      orderBy: [{ field: 'i', direction: 'asc' }],
      limit: 5,
      cursor: first.json.nextCursor,
    });
    assert.equal(second.status, 200);
    const ids = [...first.json.items, ...second.json.items].map((x: any) => x.id);
    assert.equal(new Set(ids).size, ids.length, 'pages must not overlap');
    assert.deepEqual(second.json.items.map((x: any) => x.id), [
      'doc-000012', 'doc-000014', 'doc-000016', 'doc-000018', 'doc-000020',
    ]);
  });

  it('pushes range, in and text filters down to SQL', async () => {
    const range = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { field: 'i', op: 'gte', value: 12_045 },
      limit: 10,
    });
    assert.equal(range.status, 200);
    assert.equal(range.json.total, 6);

    const listed = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { field: 'category', op: 'in', value: ['beta'] },
      limit: 1,
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.json.total, 6025);

    const text = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { field: '$text', op: 'text', value: 'streetlight broken' },
    });
    assert.equal(text.status, 200, JSON.stringify(text.json));
    assert.equal(text.json.total, 1);
    assert.equal(text.json.items[0].id, 'doc-000001');

    const fieldText = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { field: 'description', op: 'text', value: 'BROKEN' },
    });
    assert.equal(fieldText.status, 200);
    assert.equal(fieldText.json.total, 1);
  });

  it('runs geo operators server-side without loading the collection', async () => {
    const near = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { field: 'location', op: 'near', value: { lat: 10.7769, lng: 106.7009, maxDistanceKm: 5 } },
    });
    assert.equal(near.status, 200);
    assert.equal(near.json.total, 2);

    const bbox = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: { field: 'location', op: 'within', value: { bbox: [106.69, 10.77, 106.72, 10.79] } },
    });
    assert.equal(bbox.status, 200);
    assert.equal(bbox.json.total, 2);

    const polygon = await post(`/v1/base/collections/${baseHttp}/query`, {
      where: {
        field: 'location',
        op: 'within',
        value: {
          type: 'Polygon',
          coordinates: [[[106.69, 10.77], [106.72, 10.77], [106.72, 10.79], [106.69, 10.79], [106.69, 10.77]]],
        },
      },
    });
    assert.equal(polygon.status, 200);
    assert.equal(polygon.json.total, 2);
  });

  it('pushes vector-search metadata filters down but still returns ranked results', async () => {
    const name = `vec_${Date.now().toString(36)}`;
    const col = await store.createCollectionRec({ name, mapping: { fields: {} }, org_id: 'qd-tenant-a' });
    await store.pgQuery(
      `INSERT INTO synapseone_base_documents(collection_id, id, data) VALUES
       ($1, 'v1', '{"category":"keep","embedding":[1,0,0]}'::jsonb),
       ($1, 'v2', '{"category":"keep","embedding":[0,1,0]}'::jsonb),
       ($1, 'v3', '{"category":"drop","embedding":[1,0,0]}'::jsonb)`,
      [col.id],
    );
    const r = await post(`/v1/base/collections/${name}/vector-search`, {
      vector: [1, 0, 0], limit: 5, where: { category: 'keep' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.total, 2);
    assert.equal(r.json.items[0].id, 'v1');
    assert.deepEqual(r.json.items.map((i: any) => i.id).sort(), ['v1', 'v2']);
    await store.deleteCollectionRec(col.id);
  });

  it('uses the full-text GIN index and GIN-compatible containment SQL', async () => {
    const spec = query.parseQuerySpec({ where: { field: '$text', op: 'text', value: 'streetlight' } });
    const compiled = pg.compileQuery(collectionId, spec);
    const plan = await store.pgQuery<any>(
      `EXPLAIN (FORMAT JSON) SELECT count(*) FROM synapseone_base_documents WHERE ${compiled.whereSql}`,
      compiled.whereParams,
    );
    const planText = JSON.stringify(plan);
    assert.match(planText, /idx_base_documents_fts/, 'text search must be backed by the GIN index');

    const eq = pg.compileQuery(collectionId, query.parseQuerySpec({ where: { category: 'alpha' } }));
    assert.match(eq.whereSql, /data @> \$2::jsonb/, 'equality filters must compile to GIN containment');
  });

  it('lists only the requested page and reports totals', async () => {
    const page = await post(`/v1/base/collections/${baseHttp}/query`, { orderBy: [{ field: 'i', direction: 'desc' }], limit: 3, offset: 12_047 });
    assert.equal(page.status, 200);
    assert.equal(page.json.items.length, 3);
    assert.equal(page.json.total, 12_050);
    assert.equal(page.json.nextCursor, null);

    const res = await fetch(`${base}/v1/base/collections/${baseHttp}/documents?limit=2&withTotal=1`, {
      headers: { 'x-synapseone-user': 'query-test-user', 'x-synapseone-org': 'qd-tenant-a', 'x-synapseone-kind': 'user' },
    });
    const body: any = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.total, 12_050);
    assert.equal(body.items.length, 2);
    assert.equal(res.headers.get('x-total-count'), '12050');
  });

  it('keeps same-named tenant collections isolated on the SQL path', async () => {
    const name = `shared_${Date.now().toString(36)}`;
    const a = await store.createCollectionRec({ name, mapping: { fields: {} }, org_id: 'qd-tenant-a' });
    const b = await store.createCollectionRec({ name, mapping: { fields: {} }, org_id: 'qd-tenant-b' });
    await store.pgQuery(
      `INSERT INTO synapseone_base_documents(collection_id, id, data) VALUES
       ($1, 'a-1', '{"tenant":"a"}'::jsonb), ($2, 'b-1', '{"tenant":"b"}'::jsonb)`,
      [a.id, b.id],
    );
    const fromA = await store.findCollectionRec(name, { org_id: 'qd-tenant-a' });
    const fromB = await store.findCollectionRec(name, { org_id: 'qd-tenant-b' });
    assert.equal(fromA?.id, a.id);
    assert.equal(fromB?.id, b.id);
    const resultA = await store.queryDocumentRecs(a.id, query.parseQuerySpec({ where: { tenant: 'a' } }), null);
    const resultB = await store.queryDocumentRecs(b.id, query.parseQuerySpec({ where: { tenant: 'b' } }), null);
    assert.equal(resultA.total, 1);
    assert.equal(resultB.total, 1);
    await store.deleteCollectionRec(a.id);
    await store.deleteCollectionRec(b.id);
  });
});
