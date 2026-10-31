/*
 * Copyright 2026 SynapseDX Contributors
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Object backends for Synapse Storage. Production talks the S3 protocol to
 * any compatible server (S3Mock / SeaweedFS / AWS S3) via the Apache-2.0
 * AWS SDK; dev/tests use an in-memory map with identical semantics.
 *
 * Physical layout inside ONE backend bucket (S3_BUCKET):
 *   <tenant>/.buckets/<bucket>.json   logical bucket config
 *   <tenant>/<bucket>/<key>           object bytes (+ metadata)
 * Bucket names cannot start with '.', so configs never collide with objects.
 */
import { createHash } from 'crypto';
import { Readable } from 'stream';
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';

export interface ObjectInfo {
  key: string;
  size: number;
  etag: string;
  contentType: string;
  lastModified: string;
  metadata: Record<string, string>;
}

export interface ListResult {
  items: Array<{ key: string; size: number; etag: string; lastModified: string }>;
  prefixes: string[];
  nextCursor: string | null;
}

export interface ObjectBackend {
  readonly kind: 'memory' | 's3';
  put(key: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<ObjectInfo>;
  get(key: string): Promise<{ info: ObjectInfo; body: Readable } | null>;
  head(key: string): Promise<ObjectInfo | null>;
  delete(key: string): Promise<boolean>;
  list(prefix: string, opts: { cursor?: string; limit: number; delimiter?: string }): Promise<ListResult>;
  ping(): Promise<boolean>;
}

function md5(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex');
}

// ---------- memory ----------

export class MemoryBackend implements ObjectBackend {
  readonly kind = 'memory' as const;
  private objects = new Map<string, { body: Buffer; info: ObjectInfo }>();

  async put(key: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<ObjectInfo> {
    const info: ObjectInfo = { key, size: body.length, etag: md5(body), contentType, lastModified: new Date().toISOString(), metadata: { ...metadata } };
    this.objects.set(key, { body: Buffer.from(body), info });
    return { ...info };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { info: { ...o.info }, body: Readable.from(o.body) } : null;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { ...o.info } : null;
  }
  async delete(key: string) {
    return this.objects.delete(key);
  }
  async list(prefix: string, opts: { cursor?: string; limit: number; delimiter?: string }): Promise<ListResult> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const items: ListResult['items'] = [];
    const prefixes = new Set<string>();
    let next: string | null = null;
    for (const k of keys) {
      if (opts.cursor && k <= opts.cursor) continue;
      if (opts.delimiter) {
        const rest = k.slice(prefix.length);
        const i = rest.indexOf(opts.delimiter);
        if (i >= 0) {
          prefixes.add(prefix + rest.slice(0, i + 1));
          continue;
        }
      }
      if (items.length >= opts.limit) {
        next = items[items.length - 1].key;
        break;
      }
      const o = this.objects.get(k)!;
      items.push({ key: k, size: o.info.size, etag: o.info.etag, lastModified: o.info.lastModified });
    }
    return { items, prefixes: [...prefixes].sort(), nextCursor: next };
  }
  async ping() {
    return true;
  }
}

// ---------- S3 ----------

export class S3Backend implements ObjectBackend {
  readonly kind = 's3' as const;
  private s3: S3Client;
  constructor(private bucket: string, endpoint: string, region: string, accessKeyId: string, secretAccessKey: string) {
    this.s3 = new S3Client({
      endpoint,
      region,
      forcePathStyle: true, // S3Mock / SeaweedFS / MinIO-style path addressing
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private static info(key: string, r: any): ObjectInfo {
    return {
      key,
      size: Number(r.ContentLength ?? 0),
      etag: String(r.ETag || '').replace(/"/g, ''),
      contentType: r.ContentType || 'application/octet-stream',
      lastModified: (r.LastModified instanceof Date ? r.LastModified : new Date()).toISOString(),
      metadata: r.Metadata || {},
    };
  }

  async put(key: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<ObjectInfo> {
    const r = await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length, Metadata: metadata,
    }));
    return {
      key, size: body.length, etag: String(r.ETag || md5(body)).replace(/"/g, ''), contentType,
      lastModified: new Date().toISOString(), metadata,
    };
  }
  async get(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { info: S3Backend.info(key, r), body: r.Body as Readable };
    } catch (e: any) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  async head(key: string) {
    try {
      return S3Backend.info(key, await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })));
    } catch (e: any) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  async delete(key: string) {
    const existed = !!(await this.head(key));
    if (existed) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return existed;
  }
  async list(prefix: string, opts: { cursor?: string; limit: number; delimiter?: string }): Promise<ListResult> {
    const r = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.bucket, Prefix: prefix, MaxKeys: opts.limit, Delimiter: opts.delimiter,
      ...(opts.cursor ? { StartAfter: opts.cursor } : {}),
    }));
    const items = (r.Contents || []).map((c) => ({
      key: c.Key || '', size: Number(c.Size || 0), etag: String(c.ETag || '').replace(/"/g, ''),
      lastModified: (c.LastModified || new Date()).toISOString(),
    }));
    return {
      items,
      prefixes: (r.CommonPrefixes || []).map((p) => p.Prefix || '').filter(Boolean),
      nextCursor: r.IsTruncated && items.length ? items[items.length - 1].key : null,
    };
  }
  async ping() {
    try {
      await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      return true;
    } catch {
      return false;
    }
  }
}

function isNotFound(e: any): boolean {
  const code = e?.name || e?.Code || '';
  return code === 'NoSuchKey' || code === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export function backendFromEnv(): ObjectBackend {
  const endpoint = process.env.S3_ENDPOINT || '';
  if (!endpoint) return new MemoryBackend();
  return new S3Backend(
    process.env.S3_BUCKET || 'synapsedx-core',
    endpoint,
    process.env.S3_REGION || 'us-east-1',
    process.env.S3_ACCESS_KEY || '',
    process.env.S3_SECRET_KEY || '',
  );
}
