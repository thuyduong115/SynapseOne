// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUpRightFromSquare,
  faBolt,
  faDatabase,
  faKey,
  faLayerGroup,
  faRobot,
  faShieldHalved,
} from '@fortawesome/free-solid-svg-icons';
import PublicHeader from '../components/PublicHeader.jsx';

const FEATURES = [
  { icon: faShieldHalved, title: 'AWS-style IAM', text: 'Organization → Account → User → Role → JSON policy, enforced per-route scopes, authorize simulator and a mutation audit trail.' },
  { icon: faKey, title: 'Identity', text: 'Password lifecycle, rotating refresh tokens, API keys, service accounts, delegated user-token exchange and OIDC SSO.' },
  { icon: faBolt, title: 'API gateway', text: 'One public entry point with JWT/API-key auth, per-client limits, principal propagation, tracing and aggregate readiness.' },
  { icon: faDatabase, title: 'Data plane', text: 'Postgres, Redis, tenant-scoped object storage, document DB, cache/KV, queue and event stream — all behind the same API.' },
  { icon: faLayerGroup, title: 'Workflows', text: 'Built-in DAG engine: versioned templates, sandboxed code, webhooks, cron triggers, executions and a visual editor.' },
  { icon: faRobot, title: 'AI + clients', text: 'Inference with streaming and token metering, notification delivery, TypeScript/Python/Go SDKs, a CLI and this Console.' },
];

const LINKS = [
  { label: 'GitHub repository', href: 'https://github.com/vku-open-source-2026/SynapseOne' },
  { label: 'Documentation', href: 'https://github.com/vku-open-source-2026/SynapseOne/tree/main/docs' },
  { label: 'API reference', href: '/api-docs' },
  { label: 'npm SDK', href: 'https://www.npmjs.com/package/@synapseone/sdk' },
  { label: 'PyPI SDK', href: 'https://pypi.org/project/synapseone-sdk/' },
  { label: 'License (Apache-2.0)', href: 'https://github.com/vku-open-source-2026/SynapseOne/blob/main/LICENSE' },
];

export default function About() {
  return (
    <div className="min-h-screen bg-main-bg">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 pt-28 sm:pt-32 pb-16">
        <p className="text-sm font-medium text-main-blue">About</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-main-text">SynapseOne — the open Tier-1 PaaS</h1>
        <p className="mt-4 max-w-3xl text-normal-text leading-relaxed">
          SynapseOne is an Apache-2.0 platform that gives products one API for identity,
          authorization, data, workflows, events, files, notifications and AI. It is built
          by the VKU.VIC team and designed to be consumed by higher tiers: SynapseDX
          capabilities and city-scale products use the same public HTTPS gateway.
        </p>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <FontAwesomeIcon icon={f.icon} className="text-main-blue" />
              <h2 className="mt-3 font-semibold text-main-text">{f.title}</h2>
              <p className="mt-2 text-sm text-normal-text leading-relaxed">{f.text}</p>
            </div>
          ))}
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-main-text">Open source</h2>
            <p className="mt-2 text-sm text-normal-text leading-relaxed">
              All platform code is Apache-2.0 with per-source SPDX headers and third-party
              attribution. Contributions follow the repository&apos;s CODE_OF_CONDUCT and
              GOVERNANCE documents.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {LINKS.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith('/') ? (
                    <Link to={l.href} className="text-main-blue hover:underline">{l.label}</Link>
                  ) : (
                    <a href={l.href} target="_blank" rel="noreferrer" className="text-main-blue hover:underline">
                      {l.label} <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-xs" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-main-text">How the tiers fit</h2>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{`SynapseCity / SynapseCitySOS   (Tier 3)
        │  public HTTPS
        ▼
SynapseDX capabilities API/SDK  (Tier 2)
        │  @synapseone/sdk
        ▼
SynapseOne                      (Tier 1)`}</pre>
            <p className="mt-3 text-sm text-normal-text leading-relaxed">
              Tier 2 delegates user identity with the token-exchange endpoint and persists
              through Tier-1 data capabilities. Tiers 2 and 3 never share databases or
              service ports with Tier 1.
            </p>
          </div>
        </section>

        <p className="mt-10 text-sm text-normal-text">
          Maintained by Ho Sy Bao Nhan, Tran Thi Thuy Duong and Vo Thanh Nam (VKU.VIC).
        </p>
      </main>
    </div>
  );
}
