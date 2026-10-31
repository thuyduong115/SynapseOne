# Object storage (Synapse Storage + S3-compatible backend)

Unstructured data (files, images, documents, records) lives in **Synapse Storage**
(`apps/storage-service`, `:4010`, gateway `/v1/storage`). The service owns tenancy,
validation, signed links and metrics; the bytes go to any server that speaks the
standard S3 API, so the backend can be swapped without changing any calling code.

```
Client ─► Gateway /v1/storage ─(authn + storage:Read/Write/Delete policy)─► storage :4010 ─S3 API─► backend
Anyone ─► Gateway /v1/storage/signed/<token> (HMAC link, no credentials) ─► storage :4010 ─► backend
```

- **Logical buckets per tenant** (org > account > user, same rule as Faststore/Queue):
  two organizations can both own a bucket called `documents`. Physically everything is
  stored in ONE backend bucket (`S3_BUCKET`) under `<tenant>/<bucket>/<key>`; bucket
  configs live at `<tenant>/.buckets/<bucket>.json`.
- **Access control** is central: the gateway maps requests to `storage:Read`,
  `storage:Write`, `storage:Delete` and decides them against IAM policies
  (`AUTHZ_MODE=audit|enforce`, see `docs/api.md` → Central enforcement). Managed
  policies `StorageFullAccess` / `StorageReadOnlyAccess` cover the common cases.
- **Signed links** (`presign-download` needs `storage:Read`, `presign-upload` needs
  `storage:Write`) are served through the gateway, so the S3 backend never has to be
  exposed. A link pins tenant, bucket, key, method, expiry and (uploads) content type.
- **Safe serving**: downloads always carry `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`; only images/PDF/text/JSON/media
  are `inline`, everything else is `attachment` — uploaded HTML can never run on the API origin.
- Limits: `STORAGE_MAX_OBJECT_BYTES` (default 25 MiB, per-bucket `maxObjectBytes` can
  only lower it), `STORAGE_MAX_BUCKETS` per tenant (100), `STORAGE_SIGNED_URL_MAX_TTL` (7 days).
- Without `S3_ENDPOINT` the service uses an in-memory backend (dev/tests); production
  boot refuses that, a missing internal secret, or a signing secret shorter than 32 chars.

API reference: `docs/api.md` → *Storage*. SDKs: `client.storage` (JS/Python),
`CreateBucket`/`PutObject`/`PresignDownload`… (Go); CLI: `synapsedx storage …`.

## Backends (all Apache-2.0 or managed)

| Backend | License | Use |
|---|---|---|
| S3Mock (`adobe/s3mock`) | Apache-2.0 | Default in Compose (dev/demo) |
| SeaweedFS (`chrislusf/seaweedfs`, S3 gateway) | Apache-2.0 | Recommended self-hosted production backend |
| AWS S3 / other managed S3 | managed service | Cloud deployments |

MinIO is intentionally **not** the default: since 2021 it is AGPL-3.0. Running it as a
separate network service would be compatible with SynapseDX's Apache-2.0 code, but the
project keeps every bundled component permissively licensed (see `THIRD-PARTY.md`).

### Default: S3Mock (local/dev)

- Service `s3` (`adobe/s3mock`), internal endpoint `http://s3:9090`, outside the machine
  `http://localhost:9090` (`S3_HOST_PORT`).
- Bucket `synapsedx-core` (`S3_BUCKET`) is auto-created by the `s3-init` service
  (aws-cli + retry loop); `storage` waits for it.
- Try it end to end through the gateway:
  ```bash
  TOK=$(curl -s -XPOST localhost:8080/v1/auth/login -H'Content-Type: application/json' \
    -d '{"email":"demo@acme.local","orgSlug":"acme"}' | jq -r .accessToken)
  npx @synapsedx/cli --token "$TOK" storage buckets create documents
  echo hello > hello.txt
  npx @synapsedx/cli --token "$TOK" storage put documents notes/hello.txt hello.txt --type text/plain
  npx @synapsedx/cli --token "$TOK" storage presign documents notes/hello.txt --expires 600
  ```

### Production: SeaweedFS (Apache-2.0)

Replace the `s3` service image and keep the service name + `S3_*` env, e.g. in a
Compose override:

```yaml
services:
  s3:
    image: chrislusf/seaweedfs:latest
    command: server -dir=/data -s3 -s3.port=9090
    volumes: [s3data:/data]
```

`s3-init` keeps working unchanged (it only calls the S3 API). For multi-node clusters
run separate master/volume/filer/S3 components and point `S3_ENDPOINT` at the S3 gateway.

### Real AWS S3

Drop the `s3`/`s3-init` services and set `S3_ENDPOINT=https://s3.<region>.amazonaws.com`,
`S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and `S3_BUCKET` (the bucket must exist).

History: the first revision used `minio/minio` on Docker Hub, but that repo was removed
(pull error `repository does not exist`), so the default moved to S3Mock — see `NOTICE`.
