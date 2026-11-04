// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License").
 * SynapseBase Postgres query compiler (#29).
 *
 * Filter trees, ordering and pagination are compiled to parameterised SQL so
 * the database does the filtering instead of the API process scanning a
 * collection. Every value is a bind parameter; only whitelisted identifiers
 * (metadata column names, asc/desc) are ever interpolated.
 *
 * Index usage:
 *  - equality filters compile to `data @> $n::jsonb` and use the existing
 *    `idx_base_documents_data` GIN (jsonb_path_ops) index;
 *  - `$text` ($text pseudo-field) compiles to a tsvector match and uses
 *    `idx_base_documents_fts` (migration 0004);
 *  - default id ordering uses the primary key (collection_id, id);
 *  - range/geo operators are still pushed down but are not index-accelerated
 *    without PostGIS; see docs/synapsebase.md.
 */
import type { FilterNode, QuerySpec } from './query';

const META_COLUMNS: Record<string, string> = {
  $id: 'id',
  $version: 'version',
  $createdAt: 'created_at',
  $updatedAt: 'updated_at',
};

const NUMERIC_RE = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/** Escape and quote an identifier from our own fixed whitelist only. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

class Builder {
  params: unknown[] = [];

  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  jsonbExpr(field: string): string {
    const col = META_COLUMNS[field];
    if (col) return `to_jsonb(${ident(col)})`;
    const segments = field.split('.');
    return `jsonb_extract_path(data, ${segments.map((s) => this.param(s)).join(', ')})`;
  }

  textExpr(field: string): string {
    const col = META_COLUMNS[field];
    if (col) return col === 'version' ? `(${ident(col)})::text` : `${ident(col)}::text`;
    const segments = field.split('.');
    return `jsonb_extract_path_text(data, ${segments.map((s) => this.param(s)).join(', ')})`;
  }

  /** Safe float8 cast: non-numeric JSON values become NULL instead of erroring. */
  numericExpr(textExpr: string): string {
    return `(CASE WHEN ${textExpr} ~ ${this.param(NUMERIC_RE.source)} THEN (${textExpr})::float8 END)`;
  }

  /** Geo point latitude for {lat,lng}, {latitude,longitude} or [lng,lat]. */
  latExpr(field: string): string {
    const segments = field.split('.');
    const base = (extra: string[] = []) => {
      const args = [...segments, ...extra].map((s) => this.param(s)).join(', ');
      return `jsonb_extract_path_text(data, ${args})`;
    };
    const lat = this.numericExpr(base(['lat']));
    const latitude = this.numericExpr(base(['latitude']));
    const arrayLat = this.numericExpr(base(['1']));
    return `(CASE WHEN jsonb_typeof(jsonb_extract_path(data, ${segments.map((s) => this.param(s)).join(', ')})) = 'array' THEN ${arrayLat} ELSE coalesce(${lat}, ${latitude}) END)`;
  }

  lngExpr(field: string): string {
    const segments = field.split('.');
    const base = (extra: string[] = []) => {
      const args = [...segments, ...extra].map((s) => this.param(s)).join(', ');
      return `jsonb_extract_path_text(data, ${args})`;
    };
    const lng = this.numericExpr(base(['lng']));
    const lon = this.numericExpr(base(['lon']));
    const longitude = this.numericExpr(base(['longitude']));
    const arrayLng = this.numericExpr(base(['0']));
    return `(CASE WHEN jsonb_typeof(jsonb_extract_path(data, ${segments.map((s) => this.param(s)).join(', ')})) = 'array' THEN ${arrayLng} ELSE coalesce(${lng}, ${lon}, ${longitude}) END)`;
  }

  /** jsonb containment object for a dotted path, or null if not representable. */
  containment(field: string, value: unknown): string | null {
    if (META_COLUMNS[field]) return null;
    const segments = field.split('.');
    if (segments.some((s) => /^[0-9]+$/.test(s))) return null; // array index: use jsonb_extract_path
    let obj: unknown = value;
    for (let i = segments.length - 1; i >= 0; i--) obj = { [segments[i]]: obj };
    return this.param(JSON.stringify(obj));
  }

  condition(node: FilterNode): string {
    if (node.and) return `(${node.and.map((n) => this.condition(n)).join(' AND ')})`;
    if (node.or) return `(${node.or.map((n) => this.condition(n)).join(' OR ')})`;
    if (node.not) return `(NOT ${this.condition(node.not)})`;

    const field = String(node.field || '');
    const op = node.op || 'eq';
    const value = node.value;

    if (op === 'text') {
      const tsquery = this.param(String(value));
      if (field === '$text') {
        return `to_tsvector('simple', synapseone_base_doc_text(data)) @@ plainto_tsquery('simple', ${tsquery})`;
      }
      const t = this.textExpr(field);
      return `to_tsvector('simple', coalesce(${t}, '')) @@ plainto_tsquery('simple', ${tsquery})`;
    }

    if (op === 'exists') {
      const want = value === true;
      if (META_COLUMNS[field]) return want ? 'TRUE' : 'FALSE';
      return `(${this.jsonbExpr(field)} IS NOT NULL) = ${this.param(want)}`;
    }

    if (op === 'eq') {
      if (META_COLUMNS[field]) {
        if (field === '$version') return `${ident('version')} = ${this.param(Number(value))}::int`;
        if (field === '$createdAt' || field === '$updatedAt') {
          return `${ident(META_COLUMNS[field])} = ${this.param(String(value))}::timestamptz`;
        }
        return `${ident('id')} = ${this.param(String(value))}`;
      }
      const c = this.containment(field, value);
      if (c) return `data @> ${c}::jsonb`;
      return `${this.jsonbExpr(field)} = ${this.param(JSON.stringify(value))}::jsonb`;
    }

    if (op === 'ne') {
      if (META_COLUMNS[field]) {
        return `${this.jsonbExpr(field)} IS NOT NULL AND NOT (${this.condition({ ...node, op: 'eq' })})`;
      }
      const c = this.containment(field, value);
      const notEq = c ? `data @> ${c}::jsonb` : `${this.jsonbExpr(field)} = ${this.param(JSON.stringify(value))}::jsonb`;
      return `${this.jsonbExpr(field)} IS NOT NULL AND NOT (${notEq})`;
    }

    if (op === 'in' || op === 'nin') {
      const items = Array.isArray(value) ? value : [];
      const anyMatch = items.length
        ? `(${items.map((v) => this.condition({ field, op: 'eq', value: v })).join(' OR ')})`
        : 'FALSE';
      return op === 'in' ? anyMatch : `${this.jsonbExpr(field)} IS NOT NULL AND NOT ${anyMatch}`;
    }

    if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      const sqlOp = op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=';
      const jsonb = this.jsonbExpr(field);
      if (typeof value === 'number' || typeof value === 'bigint') {
        const numeric = this.numericExpr(this.textExpr(field));
        return `jsonb_typeof(${jsonb}) = 'number' AND ${numeric} ${sqlOp} ${this.param(Number(value))}::float8`;
      }
      if (typeof value === 'boolean') {
        const t = this.textExpr(field);
        return `jsonb_typeof(${jsonb}) = 'boolean' AND (${t})::boolean ${sqlOp} ${this.param(value)}::boolean`;
      }
      const t = this.textExpr(field);
      return `jsonb_typeof(${jsonb}) = 'string' AND ${t} COLLATE "C" ${sqlOp} ${this.param(String(value))}`;
    }

    if (op === 'contains') {
      const jsonb = this.jsonbExpr(field);
      const t = this.textExpr(field);
      const str = this.param(String(value ?? ''));
      const elem = this.param(JSON.stringify(value));
      return `(jsonb_typeof(${jsonb}) = 'string' AND strpos(${t}, ${str}) > 0)
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(${jsonb}) = 'array' THEN ${jsonb} ELSE '[]'::jsonb END
          ) e WHERE e = ${elem}::jsonb
        )`;
    }

    if (op === 'startsWith' || op === 'endsWith') {
      const t = this.textExpr(field);
      const s = this.param(String(value ?? ''));
      return op === 'startsWith'
        ? `left(${t}, length(${s})) = ${s}`
        : `right(${t}, length(${s})) = ${s}`;
    }

    if (op === 'near') {
      const v: any = value || {};
      const lat = this.latExpr(field);
      const lng = this.lngExpr(field);
      const qLat = this.param(Number(v.lat));
      const qLng = this.param(Number(v.lng));
      const maxKm = this.param(Number(v.maxDistanceKm ?? v.radiusKm ?? 1));
      const dLat = `radians(${lat} - ${qLat})`;
      const dLng = `radians(${lng} - ${qLng})`;
      const h = `(6371.0088 * 2 * asin(least(1, sqrt(
        power(sin(${dLat} / 2), 2)
        + cos(radians(${qLat})) * cos(radians(${lat})) * power(sin(${dLng} / 2), 2)
      ))))`;
      return `${lat} IS NOT NULL AND ${lng} IS NOT NULL AND ${h} <= ${maxKm}`;
    }

    if (op === 'within') {
      const v: any = value || {};
      const lat = this.latExpr(field);
      const lng = this.lngExpr(field);
      if (Array.isArray(v.bbox) && v.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = v.bbox.map(Number);
        return `${lat} IS NOT NULL AND ${lng} IS NOT NULL
          AND ${lat} BETWEEN ${this.param(minLat)} AND ${this.param(maxLat)}
          AND ${lng} BETWEEN ${this.param(minLng)} AND ${this.param(maxLng)}`;
      }
      const ring: number[][] | null = v.type
        ? (Array.isArray(v.coordinates?.[0]) ? v.coordinates[0] : null)
        : (Array.isArray(v.ring) ? v.ring : null);
      if (!ring || ring.length < 3) return 'FALSE';
      // Ray-casting evaluated inside Postgres: one CASE per polygon edge.
      const crossings: string[] = [];
      for (let i = 0; i < ring.length; i++) {
        const j = (i + ring.length - 1) % ring.length;
        const xi = `(${this.param(Number(ring[i]?.[0]))})::float8`;
        const yi = `(${this.param(Number(ring[i]?.[1]))})::float8`;
        const xj = `(${this.param(Number(ring[j]?.[0]))})::float8`;
        const yj = `(${this.param(Number(ring[j]?.[1]))})::float8`;
        crossings.push(`(CASE WHEN (${yi} > ${lat}) <> (${yj} > ${lat})
          AND ${lng} < (${xj} - ${xi}) * (${lat} - ${yi}) / NULLIF((${yj} - ${yi}), 0) + ${xi}
          THEN 1 ELSE 0 END)`);
      }
      return `${lat} IS NOT NULL AND ${lng} IS NOT NULL AND ((${crossings.join(' + ')}) % 2) = 1`;
    }

    return 'FALSE';
  }
}

export interface CompiledQuery {
  whereSql: string;
  whereParams: unknown[];
  orderSql: string;
  /** WHERE + ORDER BY params, in placeholder order (before limit/offset). */
  allParams: unknown[];
}

function orderExpression(b: Builder, field: string): string {
  const col = META_COLUMNS[field];
  if (col) return ident(col);
  return b.jsonbExpr(field);
}

/** Compile a parsed QuerySpec into a WHERE clause and ORDER BY list. */
export function compileQuery(collectionId: string, spec: QuerySpec): CompiledQuery {
  const b = new Builder();
  const conds = [`collection_id = ${b.param(collectionId)}`];
  if (spec.where) conds.push(b.condition(spec.where));
  // Snapshot WHERE params before ORDER BY expressions append their own
  // placeholders: COUNT(*) only reuses the WHERE list.
  const whereParams = b.params.slice();
  const order = spec.orderBy.length
    ? spec.orderBy.map((o) => `${orderExpression(b, o.field)} ${o.direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`)
    : [];
  order.push(`${ident('id')} ASC`);
  return { whereSql: conds.join(' AND '), whereParams, orderSql: order.join(', '), allParams: b.params.slice() };
}
