// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
// English copy. Keeps exactly the same keys as vi.js.

export const en = {
  meta: {
    title: 'SynapseOne Console · The open PaaS',
    description:
      'SynapseOne is an open-source Tier-1 PaaS (Apache-2.0): API gateway, AWS-style IAM, core data cluster and workflows, managed via Console, multi-language SDKs and CLI.',
  },

  nav: {
    home: 'Home',
    apiDocs: 'API docs',
    docs: 'Docs',
    about: 'About',
    signIn: 'Sign in',
    console: 'Console',
    openConsole: 'Open Console',
    switchLang: 'Chuyển sang tiếng Việt',
    langShort: 'VI',
    theme: { light: 'Light theme', dark: 'Dark theme', system: 'Match system' },
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },

  footer: {
    tagline: 'The open-source Tier-1 PaaS.',
    product: 'Product',
    project: 'Project',
    support: 'Support',
    licenses: 'Licences',
    links: {
      console: 'Console',
      apiDocs: 'API docs',
      docs: 'Docs',
      about: 'About',
      repo: 'Source code',
      releases: 'Releases',
      changelog: 'Changelog',
      npm: 'npm SDK',
      pypi: 'PyPI SDK',
      build: 'Install guide',
      issues: 'Bug reports',
      contributing: 'Contributing',
      source: 'Source: Apache-2.0',
      thirdParty: 'Third-party libraries',
    },
    bottom: '© 2026 synapseone · Apache-2.0 · Tier-1 PaaS',
  },

  landing: {
    titleBefore: 'The',
    titleHighlight: 'open',
    titleAfter: 'PaaS for your infrastructure',
    lead:
      'SynapseOne is an open-source Tier-1 PaaS (Apache-2.0): API gateway, AWS-style IAM, core data cluster and workflows, managed via Console, multi-language SDKs and CLI.',
    openConsole: 'Try it now',
    exploreApi: 'API docs',
    cliTitle: 'Install the CLI',
    cliText: 'One line, no clone needed, or run it instantly with npx (Node 18+).',
    cliComment: '# ..or without installing anything:',
    selfHostTitle: 'Self-host in 3 commands',
    selfHostEnv: '# then replace every *_change_me_* secret',
    selfHostLogin: '# sign in: demo@acme.local / org acme',
    featuresHeading: 'What the platform includes',
    features: [
      {
        title: 'AWS-style IAM',
        text: 'Organization → Account → User → Role → JSON Policy (Allow/Deny, Condition), authorize + simulator + audit log.',
      },
      {
        title: 'Flexible tokens',
        text: 'Short-lived JWT, atomic rotating refresh, API keys, service accounts, OIDC via Authentik/Keycloak.',
      },
      {
        title: 'API Gateway',
        text: 'Single entry point: auth, edge rate-limiting, principal propagation, tracing, aggregate /ready.',
      },
      {
        title: 'Core data cluster',
        text: 'Postgres + Redis + S3-compatible storage, versioned schema, idempotent seed, backup/restore.',
      },
      {
        title: 'Workflows',
        text: 'Local engine: versioned templates, sandboxed code, activate/execute, webhooks + cron, definition editor.',
      },
      {
        title: 'AI assistant + SDKs',
        text: 'Chatbot on the API Docs pre-fills try-it forms. JS/TS, Python, Go, a zero-dependency CLI and an admin Console share one API.',
      },
    ],
  },

  about: {
    kicker: 'About',
    title: 'SynapseOne, the open Tier-1 PaaS',
    intro:
      'SynapseOne is an Apache-2.0 platform that gives products one API for identity, authorization, data, workflows, events, files, notifications and AI. It is built by the VKU.VIC team and designed to be consumed by higher tiers: SynapseDX capabilities and city-scale products use the same public HTTPS gateway.',
    featuresHeading: 'Features',
    features: [
      {
        title: 'AWS-style IAM',
        text: 'Organization → Account → User → Role → JSON policy, enforced per-route scopes, authorize simulator and a mutation audit trail.',
      },
      {
        title: 'Identity',
        text: 'Password lifecycle, rotating refresh tokens, API keys, service accounts, delegated user-token exchange and OIDC SSO.',
      },
      {
        title: 'API gateway',
        text: 'One public entry point with JWT/API-key auth, per-client limits, principal propagation, tracing and aggregate readiness.',
      },
      {
        title: 'Data plane',
        text: 'Postgres, Redis, tenant-scoped object storage, document DB, cache/KV, queue and event stream, all behind the same API.',
      },
      {
        title: 'Workflows',
        text: 'Built-in DAG engine: versioned templates, sandboxed code, webhooks, cron triggers, executions and a visual editor.',
      },
      {
        title: 'AI + clients',
        text: 'Inference with streaming and token metering, notification delivery, TypeScript/Python/Go SDKs, a CLI and this Console.',
      },
    ],
    openSourceTitle: 'Open source',
    openSourceText:
      "All platform code is Apache-2.0 with per-source SPDX headers and third-party attribution. Contributions follow the repository's CODE_OF_CONDUCT and GOVERNANCE documents.",
    links: {
      repo: 'GitHub repository',
      docs: 'Documentation',
      api: 'API reference',
      npm: 'npm SDK',
      pypi: 'PyPI SDK',
      license: 'License (Apache-2.0)',
    },
    tiersTitle: 'How the tiers fit',
    tierStack: [
      { name: 'SynapseCity / SynapseCitySOS', tier: 'Tier 3' },
      { name: 'SynapseDX capabilities API/SDK', tier: 'Tier 2' },
      { name: 'SynapseOne', tier: 'Tier 1' },
    ],
    tierLinks: ['public HTTPS', '@synapseone/sdk'],
    tiersText:
      'Tier 2 delegates user identity with the token-exchange endpoint and persists through Tier-1 data capabilities. Tiers 2 and 3 never share databases or service ports with Tier 1.',
    teamTitle: 'Team',
    teamLead: 'The people who build and maintain SynapseOne (VKU.VIC)',
    partnersTitle: 'Supported by',
    partnersLead: 'Backed by organizations that believe in open source',
    partners: { vku: 'VKU University', vic: 'VKU IT Club' },
  },

  login: {
    title: 'SynapseOne Console',
    sub: 'Tier-1 PaaS admin · Gateway',
    modeEmail: 'Email (dev/OIDC)',
    modeKey: 'API Key',
    email: 'Email',
    org: 'Organization slug',
    apiKey: 'X-API-Key (synapseone_...)',
    submit: 'Sign in',
    or: 'or',
    sso: 'Continue with SSO',
    redirecting: 'Redirecting…',
    mfaCode: 'Authenticator code',
    recoveryCode: 'Recovery code',
    verify: 'Verify',
    useRecovery: 'Use a recovery code',
    useAuthenticator: 'Use authenticator code',
    back: 'Back',
    note: 'Email sign-in is for development. Production uses SSO (Authentik/Keycloak) or API keys.',
    enterKey: 'Enter an API key',
    ssoMissing: 'SSO is not configured (missing authorizeUrl from server)',
    about: 'About synapseone',
  },

  console: {
    title: 'SynapseOne Console',
    core: 'Core Platform',
    docsSection: 'Docs & References',
    docsApis: 'Docs & APIs',
    servicesSection: 'Platform Services',
    footer: 'Tier-1 PaaS · Apache-2.0',
    nav: {
      dashboard: 'Dashboard',
      orgs: 'Organizations',
      accounts: 'Accounts',
      users: 'Users',
      roles: 'Roles',
      policies: 'Policies',
      keys: 'API Keys',
      serviceAccounts: 'Service Accts',
      authorize: 'Authorize',
      audit: 'Audit Log',
      security: 'Security',
      apiDocs: 'API Docs',
      docs: 'Docs',
    },
    services: 'Services',
    showServices: 'Show Services Sidebar',
    hideServices: 'Hide Services Sidebar',
    collapseServices: 'Collapse services sidebar',
    active: 'active',
    searchServices: 'Search services...',
    noServices: 'No services match',
    clearSearch: 'Clear search',
    servicesFooter: 'Tier-1 Distributed',
    org: 'Organization',
    orgPick: 'Org…',
    account: 'Account',
    accountPick: 'Account…',
    signOut: 'Sign out',
    signOutAll: 'Sign out all sessions',
    apiKeySession: 'API key ••••',
  },

  services: {
    workflows: { category: 'Automation & AI Agents', desc: 'Visual pipelines, AI agents, decision routing & DAGs' },
    base: { category: 'Document Database', desc: 'JSON documents with object ↔ data mapping & queries' },
    queue: { category: 'Message Queue', desc: 'At-least-once message queues, leases & dead letters' },
    stream: { category: 'Event Streaming', desc: 'Distributed event stream log, consumer groups & time-series replay' },
    ocs: { category: 'Object Cloud Storage', desc: 'Buckets, objects, signed URLs, multipart upload & tenant quotas' },
    faststore: { category: 'Cache & KV Store', desc: 'Redis-backed cache, counters, hashes & distributed locks' },
    lds: { category: 'Linked Data', desc: 'NGSI-LD datasources, entity schemas & open-data licenses' },
    inference: { category: 'AI & Inference', desc: 'LLM proxy, local embeddings & Decision-2.0 routing' },
  },
};
