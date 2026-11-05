// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
// Copy every object from an old S3-compatible store into the store OCS uses,
// keeping keys and Content-Type. Runs inside the OCS image (uses its S3
// client); see tools/storage/migrate-s3mock.sh. Idempotent: objects that
// already exist with the same size are skipped.
import { S3Client } from './dist/s3.js';

const env = process.env;
const common = { region: env.STORAGE_S3_REGION || 'us-east-1', pathStyle: true };
const from = new S3Client({
  ...common,
  endpoint: env.OLD_S3_ENDPOINT,
  bucket: env.OLD_S3_BUCKET || env.STORAGE_S3_BUCKET,
  accessKey: env.OLD_S3_ACCESS_KEY || 'test',
  secretKey: env.OLD_S3_SECRET_KEY || 'test',
});
const to = new S3Client({
  ...common,
  endpoint: env.STORAGE_S3_ENDPOINT,
  bucket: env.STORAGE_S3_BUCKET,
  accessKey: env.STORAGE_S3_ACCESS_KEY,
  secretKey: env.STORAGE_S3_SECRET_KEY,
});
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

let copied = 0;
let skipped = 0;
let failed = 0;
let token;
do {
  const page = await from.list('', 1000, token);
  for (const o of page.objects) {
    const key = unxml(o.key);
    try {
      const existing = await to.head(key);
      if (existing && existing.size === o.size) {
        skipped++;
        continue;
      }
      const obj = await from.get(key);
      if (!obj) continue;
      await to.put(key, obj.body, obj.contentType);
      copied++;
    } catch (e) {
      failed++;
      console.error(`[migrate] ${key}: ${e.message || e}`);
    }
  }
  token = page.next;
} while (token);

console.log(`[migrate] copied ${copied}, already present ${skipped}, failed ${failed}`);
process.exit(failed ? 1 : 0);
