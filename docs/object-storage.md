# SynapseObjectStorage — tenant-scoped object storage

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 VKU.VIC -->

SynapseOne exposes **its own** object-storage API at `/v1/storage`; it is not a
general S3 endpoint. The service stores bytes in an S3-compatible backend
(AWS S3, MinIO, S3Mock) or, in development/single-node deployments, on a local
filesystem. S3 credentials never leave the service.

## Capabilities

| Capability | Route |
| --- | --- |
| Upload (upsert) | `PUT /v1/storage/objects/*` — raw binary body |
| Download | `GET /v1/storage/objects/*` — raw binary body |
| Metadata | `HEAD /v1/storage/objects/*` |
| Delete | `DELETE /v1/storage/objects/*` |
| List | `GET /v1/storage/objects?prefix=&limit=&cursor=` |
| Presigned URL (S3) | `POST /v1/storage/presign` |
| Multipart start | `POST /v1/storage/uploads` |
| Multipart part | `PUT /v1/storage/uploads/:id/parts/:n?key=...` |
| Multipart complete/abort | `POST /v1/storage/uploads/:id/complete`, `DELETE /v1/storage/uploads/:id` |

Every object is scoped to the caller's tenant (`org:<id>` first, then
`account:<id>`, then `user:<sub>`). A cross-tenant key returns `404`; existence
is not leaked. Platform callers (no principal) must send
`x-synapseone-tenant`.

## Uploads

```bash
# 25 MB default limit, configurable with STORAGE_MAX_OBJECT_BYTES
curl -X PUT "https://api.synapseone.space/v1/storage/objects/reports/2026/a.png" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/png" \
  -H "x-object-checksum-sha256: $(sha256sum a.png | cut -d' ' -f1)" \
  --data-binary @a.png
```

* `x-object-checksum-sha256` is optional; when supplied the server verifies it
  and returns `400 checksum_mismatch` on a mismatch.
* `STORAGE_ALLOWED_CONTENT_TYPES` (comma list) restricts the media types a
  deployment accepts; empty = all.
* Upserting an existing key returns `200`; a new key returns `201`.
* `STORAGE_TENANT_QUOTA_BYTES` (default 5 GiB) is enforced before the write and
  returns `413 quota_exceeded`.

Large files use multipart: create an upload, PUT numbered parts (up to 10 000),
then complete with the returned ETags. The filesystem backend assembles the
parts; S3 uses native multipart.

## Presigned URLs

`POST /v1/storage/presign` returns a short-lived URL (default 900 s) for
`GET`/`PUT`/`DELETE`/`HEAD`. It requires the S3 backend; the filesystem backend
returns `501 presign_unsupported`. The URL embeds S3 credentials scoped to one
object/key, so hand it only to the intended client.

## Backends

| Setting | Dev | Production |
| --- | --- | --- |
| `STORAGE_BACKEND` | `fs` | `s3` (required by the boot guard) |
| `STORAGE_FS_ROOT` | `/data` (volume) | — |
| `STORAGE_S3_ENDPOINT` | `http://s3:9090` | your S3/MinIO endpoint |
| `STORAGE_S3_BUCKET` | `synapseone-core` | dedicated bucket |
| `STORAGE_S3_ACCESS_KEY` / `_SECRET_KEY` | `test`/`test` | scoped IAM credentials |
| `STORAGE_S3_REGION` | `us-east-1` | backend region |
| `STORAGE_S3_PATH_STYLE` | `true` | `false` for AWS virtual-host style |

Compose ships S3Mock for local development; replace it with MinIO or AWS S3 in
production. The bucket policy should allow only the storage-service credentials
to read/write the bucket; clients never talk to S3 directly.

## SDK

```ts
const { object } = await c.storage.putObject('photos/a.png', bytes, { contentType: 'image/png' });
const data = await c.storage.getObject('photos/a.png');           // Uint8Array
const page = await c.storage.listObjects({ prefix: 'photos/' }); // {objects,nextCursor}
const { url } = await c.storage.presign('photos/a.png', { method: 'GET', expiresIn: 300 });
```

Python and Go expose the same operations (`put_object`/`get_object`,
`PutObject`/`GetObject`, multipart, presign). The old claim that SynapseOne
"speaks the standard S3 API" was inaccurate and is removed.

## Tier-2/Tier-3 guidance

Tier 2 should wrap this API as a file capability and store only object keys or
presigned URLs in Base records. Tier 3 must not embed base64 data URLs: upload
the file and persist the returned key. This removes the Base 256 KB document
limit from photo/evidence flows.
