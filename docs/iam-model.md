# IAM model — AWS-style

## Hierarchy

```
Organization (globally unique slug, e.g. `acme`)
 └─ Account (slug unique within the org, e.g. `prod`, `staging`)
     ├─ Role (e.g. `admin`, `viewer`, `etl-runner`)
     ├─ Policy (AWS-style JSON, attached to Roles via role_policies)
     ├─ User (belongs to an Org, granted Roles via user_roles — can span accounts)
     ├─ ApiKey (belongs to an Account, SHA-256 hash, prefix lookup)
     └─ ServiceAccount (machine identity)
Global: audit_log records every authorize decision (see `GET /v1/audit`).
```

## Policy JSON

```json
{
  "Version": "2026-01-01",
  "Statement": [
    { "Effect": "Allow", "Action": ["workflow:Execute", "workflow:Read"], "Resource": "*" },
    { "Effect": "Deny", "Action": ["iam:*", "org:Delete"], "Resource": "*" }
  ]
}
```

- `Action`: `service:Verb`, supports `*` and `prefix:*` (e.g. `workflow:*`, `iam:*`).
- `Resource`: ARN-ish or `*` (e.g. `arn:synapsedx:acme:prod:workflow:etl-nightly`).
- Evaluation: **explicit Deny wins → Allow → default Deny**.

## Condition (AWS subset)

Statements support `Condition` with `StringEquals`, `StringLike` (`*` wildcard) and
`...IfExists` variants (skip missing keys). Unknown operators → conservative deny.

```json
{ "Effect": "Allow", "Action": ["data:Read"], "Resource": "*",
  "Condition": { "StringEquals": { "team": "etl" } } }
```

`POST /v1/authorize` accepts extra `context` (e.g. `{"team":"etl"}`); the server always
forces `user/org/email` from the DB so callers can't spoof those keys. Dry-run takes
`context` directly.

## Tokens

| Type | Format | Default TTL | Storage |
|---|---|---|---|
| Access JWT | Bearer `eyJ...` (HS256) | 3600s | stateless, verified with `IAM_JWT_SECRET` |
| Refresh | `synapsedx_rt_...` opaque, **rotating** | 30 days | HMAC-SHA256 hash (with `IAM_API_KEY_PEPPER`; legacy SHA-256 still verifies) in `refresh_tokens`; single-use, revoked on logout |
| API key | `synapsedx_...` | optional/no expiry | HMAC-SHA256 hash (pepper, legacy fallback) in `api_keys` + prefix index, revoke with `DELETE /v1/keys/:id` |
| Service account | Bearer JWT `kind=service-account` | 3600s | stateless, carries the `account` scope |

Notes: access JWTs are stateless so they **can't be individually revoked** — keep a short
TTL (1h) and revoke at the refresh layer (`/v1/auth/logout`, `/v1/auth/logout-all`). For
instant revocation: rotate `IAM_JWT_SECRET` (restart iam+gateway, all old JWTs die).

API keys: `scopes` are action patterns (`*`, `storage:*`, `workflow:Execute`). A key
created with `userId` is **owner-bound** and inherits that user's permissions; without
an owner it is an account-level key bounded by its scopes alone. Keys record
`last_used_at` and can be rotated (`POST /v1/keys/:id/rotate {graceSeconds}` — the old
secret stays valid for the grace window, 0 = revoked immediately). Users can list and
revoke their own sessions (`GET/DELETE /v1/auth/sessions[/:id]`).

## Organization administrators

The first user of an organization becomes its administrator (`is_org_admin`, AWS
"root"-like): full access inside its own org unless a policy explicitly denies. Later
users start with **no permissions**. Admins manage admins with
`PUT /v1/users/:userId/org-admin {isOrgAdmin}`; the last admin cannot be demoted.

## Managed policies

`GET /v1/managed-policies` lists ready-made documents — `AdministratorAccess`,
`PowerUserAccess` (all but `iam:*`), `ReadOnlyAccess` (`*:Read|Get|List|Describe`),
`StorageFullAccess`, `StorageReadOnlyAccess`, `DataFullAccess` (Base, Faststore, Queue,
Stream, Storage). Instantiate one in an account with
`POST /v1/accounts/:accountId/policies {slug, managed: "ReadOnlyAccess"}` and attach it
to a role like any other policy. Service accounts can hold roles too
(`POST /v1/service-accounts/:id/roles {roleId}`).

## Central enforcement at the gateway

With `AUTHZ_MODE=audit|enforce`, every authenticated request on a route that declares
a `service` is mapped to an action and an ARN and decided by IAM for the verified
principal:

```
GET /v1/storage/buckets/documents/objects/q3.pdf   (user in org O)
  → action   storage:Read
  → resource arn:synapsedx:O:-:storage:buckets/documents/objects/q3.pdf
  → allowed = scopes(credential) ∧ (org admin ∨ identity policies Allow) ∧ ¬explicit Deny
```

`GET`/`HEAD` → `Read`, `DELETE` → `Delete`, other methods → `Write`; routes override
RPC-style POSTs (`…/query` → `base:Read`, `…/execute` → `workflow:Execute`,
`/v1/ai/*` → `ai:Invoke`, `presign-download` → `storage:Read`). `audit` only logs
(response header `x-synapsedx-authz: would-deny; …`), `enforce` answers
`403 {error:"access_denied", action, resource, reason}`. Denials are written to the
audit log (`GET /v1/audit?allowed=false`). Decisions are cached for
`AUTHZ_CACHE_TTL_MS` (30 s).

## OIDC (Authentik / Keycloak)

- `GET /v1/auth/oidc/config` — issuer/client (+ `codeExchange` capability flag).
- `GET /v1/auth/oidc/start?org=<slug>` — builds the authorize URL with an HMAC-signed,
  10-minute `state`.
- `POST /v1/auth/oidc/callback {code, state}` — **real** Authorization Code exchange:
  the code is redeemed at the IdP token endpoint and the ID token is verified against
  the IdP JWKS (asymmetric signature required, issuer + audience checked); a shadow
  user is created/updated from the verified `email`/`sub` claims and platform tokens
  are minted.
- `POST /v1/auth/oidc/callback {email, orgSlug}` — **demo** mode (dev only): trusts the
  caller-supplied email. Disable in production (`IAM_ALLOW_OIDC_DEMO_CALLBACK=false`).
- Switching to Keycloak only needs `OIDC_ISSUER=https://keycloak/realms/<realm>` + the
  matching client — no code changes.

## End-to-end authorization example (via gateway — direct :4001 needs auth, see SECURITY.md)

```bash
GW=localhost:8080
TOK=$(curl -s -XPOST $GW/v1/auth/login -H'Content-Type: application/json' -d'{"email":"demo@acme.local","orgSlug":"acme"}' | jq -r .accessToken)
H="Authorization: Bearer $TOK"
ORG=$(curl -s $GW/v1/orgs -H"$H" | jq -r '.[0].id')
ACC=$(curl -s $GW/v1/orgs/$ORG/accounts -H"$H" | jq -r '.[0].id // empty')
# if there is no account yet:
ACC=$(curl -s -XPOST $GW/v1/orgs/$ORG/accounts -H'Content-Type: application/json' -H"$H" -d'{"slug":"prod","displayName":"Production"}' | jq -r .id)
ROLE=$(curl -s -XPOST $GW/v1/accounts/$ACC/roles -H'Content-Type: application/json' -H"$H" -d'{"slug":"etl-runner"}' | jq -r .id)
POL=$(curl -s -XPOST $GW/v1/accounts/$ACC/policies -H'Content-Type: application/json' -H"$H" -d'{"slug":"run-only","document":{"Version":"2026-01-01","Statement":[{"Effect":"Allow","Action":["workflow:Execute"],"Resource":"*"},{"Effect":"Deny","Action":["iam:*"],"Resource":"*"}]}}' | jq -r .id)
curl -XPOST $GW/v1/roles/$ROLE/attach -H'Content-Type: application/json' -H"$H" -d"{\"policyId\":\"$POL\"}"
```
