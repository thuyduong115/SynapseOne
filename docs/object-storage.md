# SynapseOCS — object cloud storage

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 VKU.VIC -->

SynapseOCS (Object Cloud Storage) is the Tier-1 bucket-aware object store. It
speaks its own `/v1/ocs` API at the gateway and keeps the original
`/v1/storage` API as the default-bucket compatibility surface. Bytes live in an
S3-compatible backend (MinIO / AWS S3 / Cloudflare R2). The bundled S3Mock
(`adobe/s3mock`) is a **development test double only** — it is not durable
production storage. In production the service fails closed when
`STORAGE_S3_ENDPOINT` is unset and logs a loud warning when the endpoint is a
private/`http://` mock address.

## Capabilities

| Capability | Route |
| --- | --- |
| Bucket create/list/get/head/stats/delete | `/v1/ocs/buckets`, `/v1/ocs/buckets/:bucket`, `/v1/ocs/buckets/:bucket/stats` |
| Object upload (upsert) | `PUT /v1/ocs/buckets/:bucket/objects/*` |
| Object download/head/delete | `GET`/`HEAD`/`DELETE /v1/ocs/buckets/:bucket/objects/*` |
| List objects (prefix + delimiter) | `GET /v1/ocs/buckets/:bucket/objects?prefix=&delimiter=&limit=&cursor=` |
| Copy object | `POST /v1/ocs/buckets/:bucket/objects/copy` |
| Presigned URL | `POST /v1/ocs/buckets/:bucket/presign` |
| Multipart | `POST /v1/ocs/buckets/:bucket/uploads`, `PUT .../parts/:n`, `POST .../complete`, `DELETE .../:id` |
| Legacy default bucket | `/v1/storage/*` (unchanged) |

Every bucket and object is tenant-scoped (`org:<id>` first, then `account:<id>`,
then `user:<sub>`). Cross-tenant reads return `404`; there is no existence
leak. Platform callers must send `x-synapseone-tenant`.

## Buckets

```bash
curl -X POST https://api.synapseone.space/v1/ocs/buckets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"city-assets","quotaBytes":1073741824}'

curl https://api.synapseone.space/v1/ocs/buckets/city-assets \
  -H "Authorization: Bearer $TOKEN"

curl -X DELETE 'https://api.synapseone.space/v1/ocs/buckets/city-assets?force=true' \
  -H "Authorization: Bearer $TOKEN"
```

Bucket names follow S3-style lowercase rules (3–63 characters). `default` is a
virtual bucket backed by the legacy key space and cannot be deleted. Deleting a
non-empty bucket requires `?force=true`; that removes every object and the
bucket marker.

## Objects

```bash
curl -X PUT "https://api.synapseone.space/v1/ocs/buckets/city-assets/objects/2026/10/photo.png" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/png" \
  -H "x-object-checksum-sha256: $(sha256sum photo.png | cut -d' ' -f1)" \
  --data-binary @photo.png

curl "https://api.synapseone.space/v1/ocs/buckets/city-assets/objects/2026/10/photo.png" \
  -H "Authorization: Bearer $TOKEN" -H 'Range: bytes=0-1023'
```

* Checksums are verified when `x-object-checksum-sha256` is supplied.
* `Range` and `If-Match`/`If-None-Match` are supported (single range).
* Size limits: `STORAGE_MAX_OBJECT_BYTES` (25 MiB default) and
  `STORAGE_TENANT_QUOTA_BYTES` (5 GiB default); buckets may set a smaller
  `quotaBytes`.
* List responses include `objects`, `commonPrefixes` (when `delimiter` is
  supplied) and an opaque `nextCursor`.

## Multipart

Create an upload, PUT numbered parts (max 10,000), then complete with the
returned ETags. The filesystem backend assembles the parts; S3/MinIO uses
native multipart. Abort removes the temporary upload directory.

## Presigned URLs

`POST /v1/ocs/buckets/:bucket/presign` returns a short-lived HMAC-signed URL
(default 900 s, max 7 days) for `GET`/`PUT`/`DELETE`/`HEAD`. It works on both
backends and never exposes backend S3 credentials. The URL is scoped to one
tenant/bucket/key/method; hand it only to the intended client. The legacy
`/v1/storage/presign` route still requires the S3 backend.

## Backends

| Setting | Dev | Production |
| --- | --- | --- |
| `STORAGE_BACKEND` | `fs` | `s3` (required by the boot guard) |
| `STORAGE_FS_ROOT` | `/data` (volume) | — |
| `STORAGE_S3_ENDPOINT` | `http://s3:9090` (dev S3Mock) | real MinIO/AWS S3/R2 HTTPS endpoint |
| `STORAGE_S3_BUCKET` | `synapseone-core` | dedicated bucket |
| `STORAGE_S3_ACCESS_KEY` / `_SECRET_KEY` | `test`/`test` | scoped credentials |
| `STORAGE_S3_REGION` | `us-east-1` | backend region |
| `STORAGE_S3_PATH_STYLE` | `true` | `false` for AWS virtual-host style |

Compose ships S3Mock for local development only; never ship it as production
storage. For a real deployment point `STORAGE_S3_ENDPOINT` at MinIO/AWS S3/R2
and keep `STORAGE_S3_PATH_STYLE=true` (MinIO) or `false` (AWS). The bucket
policy should allow only SynapseOCS credentials to read/write the backend;
clients should use the OCS API/presigned URLs, not the backend directly.

## SDK

TypeScript:

```ts
const bucket = await c.ocs.createBucket('city-assets', { quotaBytes: 1_073_741_824 });
await c.ocs.putObject('city-assets', '2026/10/photo.png', bytes, { contentType: 'image/png' });
const bytes = await c.ocs.getObject('city-assets', '2026/10/photo.png', { range: 'bytes=0-1023' });
const page = await c.ocs.listObjects('city-assets', { prefix: '2026/', delimiter: '/' });
const copied = await c.ocs.copyObject('city-assets', { sourceKey: 'a.png', destinationKey: 'b.png' });
const { url } = await c.ocs.presign('city-assets', 'a.png', { method: 'GET', expiresIn: 300 });
```

Python: `client.ocs.create_bucket`, `put_object`, `get_object`, `list_objects`,
`copy_object`, `presign`, multipart.

Go: `CreateOcsBucket`, `PutOcsObject`, `GetOcsObject`, `ListOcsObjects`,
`CopyOcsObject`, `PresignOcs`, multipart.

`client.storage` / `StorageService` remains the default-bucket compatibility
API (`/v1/storage`).

## Tier-2/Tier-3 guidance

Tier 2 wraps SynapseOCS as the files capability and stores bucket/key metadata
in Base; it does not store base64 payloads in documents. Tier 3 uploads evidence
and stores the returned bucket/key or presigned URL. Neither Tier 2 nor Tier 3
talks to the backend S3/MinIO credentials directly.
