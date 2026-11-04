// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Notification persistence: Postgres in production, in-memory for dev/tests.
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export type Channel = 'email' | 'sms' | 'webhook' | 'push' | 'log';
export type NotificationStatus = 'queued' | 'sending' | 'delivered' | 'failed' | 'dead' | 'cancelled';

export interface DeliveryAttempt {
  at: string;
  ok: boolean;
  error?: string;
}

export interface NotificationRecord {
  id: string;
  tenant: string;
  channel: Channel;
  recipient: Record<string, string>;
  subject: string;
  body: string;
  status: NotificationStatus;
  attempts: DeliveryAttempt[];
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  deadReason: string | null;
  metadata: Record<string, unknown>;
}

export interface PreferenceRecord {
  tenant: string;
  recipient: string;
  channels: Channel[];
  unsubscribed: boolean;
  updatedAt: string;
}

const DATABASE_URL = process.env.DATABASE_URL || '';
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
pool?.on('error', (e) => console.error('[notifications][db] pool error', e.message));

let ensured = false;
export async function ensureTables(): Promise<void> {
  if (!pool || ensured) return;
  ensured = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY,
      tenant text NOT NULL,
      channel text NOT NULL,
      recipient jsonb NOT NULL,
      subject text NOT NULL DEFAULT '',
      body text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
      idempotency_key text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      dead_reason text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_idem_key
      ON notifications (tenant, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS notifications_tenant_created ON notifications (tenant, created_at DESC);
    CREATE INDEX IF NOT EXISTS notifications_due ON notifications (status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS notification_preferences (
      tenant text NOT NULL,
      recipient text NOT NULL,
      channels jsonb NOT NULL DEFAULT '[]'::jsonb,
      unsubscribed boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant, recipient)
    );
  `).catch((e) => { ensured = false; throw e; });
}

export function useDb(): boolean { return !!pool; }

const mem = {
  notifications: new Map<string, NotificationRecord>(),
  preferences: new Map<string, PreferenceRecord>(),
};

function iso(v: any): string {
  if (!v) return new Date(0).toISOString();
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function rowToRecord(r: any): NotificationRecord {
  return {
    id: r.id,
    tenant: r.tenant,
    channel: r.channel,
    recipient: typeof r.recipient === 'string' ? JSON.parse(r.recipient) : r.recipient,
    subject: r.subject || '',
    body: r.body,
    status: r.status,
    attempts: typeof r.attempts === 'string' ? JSON.parse(r.attempts) : (r.attempts || []),
    idempotencyKey: r.idempotency_key ?? null,
    metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {}),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    nextAttemptAt: iso(r.next_attempt_at),
    deadReason: r.dead_reason ?? null,
  };
}

export async function createNotification(input: Omit<NotificationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'attempts' | 'nextAttemptAt' | 'deadReason'>): Promise<NotificationRecord> {
  const now = new Date().toISOString();
  const record: NotificationRecord = {
    ...input,
    id: randomUUID(),
    status: 'queued',
    attempts: [],
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    deadReason: null,
  };
  if (pool) {
    await ensureTables();
    const rows = await pool.query(
      `INSERT INTO notifications (id, tenant, channel, recipient, subject, body, status, attempts, idempotency_key, metadata, created_at, updated_at, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,'queued','[]'::jsonb,$7,$8,now(),now(),now())
       ON CONFLICT (tenant, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [record.id, record.tenant, record.channel, JSON.stringify(record.recipient), record.subject, record.body, record.idempotencyKey, JSON.stringify(record.metadata)],
    );
    if (rows.rows[0]) return rowToRecord(rows.rows[0]);
    const existing = await pool.query('SELECT * FROM notifications WHERE tenant=$1 AND idempotency_key=$2 LIMIT 1', [record.tenant, record.idempotencyKey]);
    return rowToRecord(existing.rows[0]);
  }
  if (record.idempotencyKey) {
    for (const n of mem.notifications.values()) {
      if (n.tenant === record.tenant && n.idempotencyKey === record.idempotencyKey) return { ...n };
    }
  }
  mem.notifications.set(record.id, record);
  return { ...record };
}

export async function getNotification(tenant: string, id: string): Promise<NotificationRecord | null> {
  if (pool) {
    await ensureTables();
    const rows = await pool.query('SELECT * FROM notifications WHERE tenant=$1 AND id=$2', [tenant, id]);
    return rows.rows[0] ? rowToRecord(rows.rows[0]) : null;
  }
  const n = mem.notifications.get(id);
  return n && n.tenant === tenant ? { ...n } : null;
}

export async function listNotifications(tenant: string, opts: { status?: string; limit?: number } = {}): Promise<NotificationRecord[]> {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  if (pool) {
    await ensureTables();
    const rows = opts.status
      ? await pool.query('SELECT * FROM notifications WHERE tenant=$1 AND status=$2 ORDER BY created_at DESC LIMIT $3', [tenant, opts.status, limit])
      : await pool.query('SELECT * FROM notifications WHERE tenant=$1 ORDER BY created_at DESC LIMIT $2', [tenant, limit]);
    return rows.rows.map(rowToRecord);
  }
  return [...mem.notifications.values()]
    .filter((n) => n.tenant === tenant && (!opts.status || n.status === opts.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((n) => ({ ...n }));
}

export async function updateNotification(id: string, patch: Partial<Pick<NotificationRecord, 'status' | 'attempts' | 'nextAttemptAt' | 'deadReason'>>): Promise<void> {
  const updatedAt = new Date().toISOString();
  if (pool) {
    await ensureTables();
    await pool.query(
      `UPDATE notifications SET status=COALESCE($2,status), attempts=COALESCE($3,attempts), next_attempt_at=COALESCE($4,next_attempt_at), dead_reason=COALESCE($5,dead_reason), updated_at=$6 WHERE id=$1`,
      [id, patch.status ?? null, patch.attempts ? JSON.stringify(patch.attempts) : null, patch.nextAttemptAt ?? null, patch.deadReason ?? null, updatedAt],
    );
    return;
  }
  const n = mem.notifications.get(id);
  if (!n) return;
  Object.assign(n, patch, { updatedAt });
}

export async function cancelNotification(tenant: string, id: string): Promise<NotificationRecord | null> {
  if (pool) {
    await ensureTables();
    const rows = await pool.query(
      "UPDATE notifications SET status='cancelled', updated_at=now() WHERE tenant=$1 AND id=$2 AND status IN ('queued','failed') RETURNING *",
      [tenant, id],
    );
    return rows.rows[0] ? rowToRecord(rows.rows[0]) : null;
  }
  const n = mem.notifications.get(id);
  if (!n || n.tenant !== tenant || !['queued', 'failed'].includes(n.status)) return null;
  n.status = 'cancelled';
  n.updatedAt = new Date().toISOString();
  return { ...n };
}

/** Claim due notifications for delivery (single replica-safe on Postgres). */
export async function claimDue(limit = 20): Promise<NotificationRecord[]> {
  if (pool) {
    await ensureTables();
    const rows = await pool.query(
      `UPDATE notifications SET status='sending', updated_at=now()
       WHERE id IN (
         SELECT id FROM notifications
         WHERE status IN ('queued','failed') AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT $1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [limit],
    );
    return rows.rows.map(rowToRecord);
  }
  const now = Date.now();
  const due = [...mem.notifications.values()]
    .filter((n) => ['queued', 'failed'].includes(n.status) && Date.parse(n.nextAttemptAt) <= now)
    .slice(0, limit);
  for (const n of due) { n.status = 'sending'; n.updatedAt = new Date().toISOString(); }
  return due.map((n) => ({ ...n }));
}

export async function getPreference(tenant: string, recipient: string): Promise<PreferenceRecord | null> {
  if (pool) {
    await ensureTables();
    const rows = await pool.query('SELECT * FROM notification_preferences WHERE tenant=$1 AND recipient=$2', [tenant, recipient]);
    const r = rows.rows[0];
    return r ? { tenant: r.tenant, recipient: r.recipient, channels: r.channels, unsubscribed: r.unsubscribed, updatedAt: iso(r.updated_at) } : null;
  }
  const p = mem.preferences.get(`${tenant}\u0000${recipient}`);
  return p ? { ...p } : null;
}

export async function setPreference(tenant: string, recipient: string, channels: Channel[], unsubscribed: boolean): Promise<PreferenceRecord> {
  const now = new Date().toISOString();
  const record: PreferenceRecord = { tenant, recipient, channels, unsubscribed, updatedAt: now };
  if (pool) {
    await ensureTables();
    const rows = await pool.query(
      `INSERT INTO notification_preferences (tenant, recipient, channels, unsubscribed, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (tenant, recipient) DO UPDATE SET channels=$3, unsubscribed=$4, updated_at=now()
       RETURNING *`,
      [tenant, recipient, JSON.stringify(channels), unsubscribed],
    );
    const r = rows.rows[0];
    return { tenant: r.tenant, recipient: r.recipient, channels: r.channels, unsubscribed: r.unsubscribed, updatedAt: iso(r.updated_at) };
  }
  mem.preferences.set(`${tenant}\u0000${recipient}`, record);
  return record;
}

export function __clearNotificationMem(): void {
  mem.notifications.clear();
  mem.preferences.clear();
}
