// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Typed gateway health/readiness contract (issue #42).
 */

import { HttpClient, RequestOptions, SynapseOneError } from './_http';

export interface DependencyStatus {
  name: string;
  ok: boolean;
  status?: number;
  ms?: number;
  version?: string;
  error?: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  time: string;
  schemaVersion?: string;
  dependencies?: DependencyStatus[];
}

export interface ReadyResponse {
  status: 'ready' | 'degraded' | string;
  service: string;
  version: string;
  upstreams: DependencyStatus[];
  time: string;
  schemaVersion?: string;
}

export interface StatusResponse {
  ok: boolean;
  tier1: { status: string; version?: string; reachable: boolean; httpStatus?: number };
  upstreams: DependencyStatus[];
  time?: string;
}

export interface ReadyOptions extends RequestOptions {
  /** Throw on a degraded (503) response instead of returning it (default false). */
  throwOnDegraded?: boolean;
}

export class HealthService {
  constructor(private readonly http: HttpClient) {}

  /** Shallow gateway health (never throws on a degraded dependency). */
  health(opts: RequestOptions = {}): Promise<HealthResponse> {
    return this.http.req<HealthResponse>('/health', undefined, { maxAttempts: 1, ...opts });
  }

  /**
   * Aggregate readiness. A 503 means "degraded", not "unreachable": by default
   * the parsed payload is returned so callers can project the upstream list.
   * Set `throwOnDegraded: true` for strict probe semantics.
   */
  async ready(opts: ReadyOptions = {}): Promise<ReadyResponse> {
    try {
      return await this.http.req<ReadyResponse>('/ready', undefined, { maxAttempts: 1, ...opts });
    } catch (e) {
      if (e instanceof SynapseOneError && e.status === 503 && e.body && !opts.throwOnDegraded) {
        return e.body as ReadyResponse;
      }
      throw e;
    }
  }

  /** Convenience projection used by Tier-2 `/ready` endpoints. */
  async status(opts: ReadyOptions = {}): Promise<StatusResponse> {
    const [health, ready] = await Promise.all([
      this.health(opts).catch((e) => ({ error: e })),
      this.ready(opts).catch((e) => ({ error: e })),
    ]);
    const upstreams = Array.isArray((ready as any)?.upstreams) ? (ready as any).upstreams : [];
    const reachable = !!(health as any)?.status && !(health as any)?.error;
    return {
      ok: reachable && (ready as any)?.status === 'ready',
      tier1: {
        status: (health as any)?.status || 'unreachable',
        version: (health as any)?.version,
        reachable,
        httpStatus: (health as any)?.error?.status,
      },
      upstreams,
      time: (ready as any)?.time,
    };
  }
}
