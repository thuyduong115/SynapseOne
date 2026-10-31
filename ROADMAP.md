# Roadmap

## v0.6.x (current)
- [x] Synapse Inference Engine (:4008), SynapseStream (:4009), full SDK coverage
- [x] **Central policy enforcement** at the gateway (`AUTHZ_MODE=off|audit|enforce`):
      every authenticated request → `<service>:<Verb>` on an ARN, decided by IAM for
      users, service accounts and API keys; denials audited
- [x] **Token management**: API-key scopes enforced, owner-bound keys, `last_used_at`,
      zero-downtime rotation, per-session revoke, org administrators, AWS-style managed
      policies, service-account roles
- [x] **Synapse Storage** (:4010, `/v1/storage`): tenant buckets, objects, HMAC-signed
      links via the gateway, S3Mock/SeaweedFS/AWS S3 backends, SDKs + CLI + Console
- [ ] Guardrail policies per org/account (AWS SCP-like) and STS-style AssumeRole
- [ ] Unify API-key tenancy with the owning org (keys currently resolve to the account tenant)
- [ ] Storage quotas per tenant + multipart uploads for very large objects

## v0.5 (this release) ✅
- [x] **SynapseBase** (:4005, `/v1/base`): document collections, object↔data
      mapping with validation, filters/ordering/cursors, `ifVersion`, atomic
      increments, batch writes, change feed, Postgres + memory backend
- [x] **Synapse Faststore** (:4006, `/v1/faststore`): Redis-backed TTL strings,
      counters, hashes, lists, sets, sorted sets, scans, batches, distributed
      locks; namespaced per tenant
- [x] **SynapseQueue** (:4007, `/v1/queue`): delayed/deduped publish,
      visibility-timeout leases, ack/nack/heartbeat, retries, dead letters,
      replay, purge/stats; Redis Lua + memory backend
- [x] Gateway routes + `/ready`, compose/prod/K8s/monitoring, env docs
- [x] SDK 0.5.0: per-service Python modules, JS subpath exports, Go Base/
      Faststore/Queue methods + typed `BaseCollection`; deprecated flat aliases
- [x] Docs: service guides for all three + API/architecture/configuration/
      quickstart/SDK/README updates

## v0.1 (Tier-1 PaaS MVP) ✅
- [x] API Gateway: proxy (pathFilter, no strip bugs), JWT/API-key (+strict verify mode),
      principal `x-synapsedx-*` propagation, `x-request-id`, rate-limit (Redis/Lua, fail-open),
      proxy timeout, CORS gating, `/ready` aggregate, Prometheus, graceful shutdown
- [x] IAM: Organization/Account/User/Role/Policy AWS-style + Conditions
      (StringEquals/StringLike/IfExists) + `POST /v1/authorize` + dry-run simulator + audit log
- [x] Token: JWT + atomic rotating refresh + logout/logout-all + API key
      (verify/revoke) + service account + OIDC (Authentik/Keycloak) + dev-login kill-switch
- [x] Core data: Postgres (schema + seed) + Redis + S3 (S3Mock, bucket init) via compose
- [x] Workflow: n8n proxied control-plane + 3 versioned templates (webhookId-correct) +
      activate/deactivate/execute/get + trigger→execution verified on real n8n
- [x] SDKs: JS/TS + Python + Go (full API parity), Apache-2.0, unit + live tested
- [x] Dockerfiles + .dockerignore, compose (parametrized ports, healthchecks, unified tags),
      K8s base (probes, secrets example), CI (build/test/docker/e2e incl. SDK smoke), 10+ docs

## v0.2 (next)
- [x] Real OIDC Authorization Code flow (dependency-free: discovery + JWKS ID-token
      verification in IAM, HMAC-signed state, Console `/oidc/callback` round-trip)
- [x] Enforce API-key scopes at gateway (central) — done in v0.6.x (`AUTHZ_MODE`)
- [ ] Audit retention job
- [x] License check in CI (zero-dep copyleft gate `tools/license-check.cjs` + SBOM artifact + `pip-licenses` fail-on GPL) — tree verified clean (290 pkgs: MIT/Apache-2.0/ISC/BSD, no GPL/AGPL)
- [x] S3 bucket API (signed URLs, backend swap via env) — done in v0.6.x as Synapse Storage
- [ ] n8n credential auto-provisioning + execution webhooks → synapsedx events
- [ ] e2e with real Postgres (testcontainers) + load test gateway
- [ ] Helm chart + production hardening guide

## v0.3+
- Tier-2 ideas (out of scope for PaaS core): function runtime, managed DB provisioning, marketplace.
