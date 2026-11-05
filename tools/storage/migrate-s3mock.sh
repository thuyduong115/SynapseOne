#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 VKU.VIC
# Move objects from the old S3Mock volume into the production object store
# (SeaweedFS `s3` service in docker-compose.prod.yml). Run from the repository
# root after the new `s3` service is up:
#
#   tools/storage/migrate-s3mock.sh
#
# A temporary S3Mock is started on the old `s3data` volume; the OCS image then
# copies each object (key + Content-Type) with tools/storage/migrate-s3mock.mjs.
# Re-running is safe. The old volume is left untouched.
set -eu

compose="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
project="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]')}"
network="${project}_synapseone-net"
old_volume="${project}_s3data"
old="s3mock-migrate-$$"

docker volume inspect "$old_volume" >/dev/null 2>&1 || { echo "no $old_volume volume: nothing to migrate"; exit 0; }
trap 'docker rm -f "$old" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$old" --network "$network" \
  -e COM_ADOBE_TESTING_S3MOCK_STORE_FILESYSTEM_ROOT=/data \
  -e COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT=true \
  -v "$old_volume:/data" adobe/s3mock:latest >/dev/null
echo "waiting for the temporary S3Mock…"
for i in $(seq 1 30); do
  docker run --rm --network "$network" curlimages/curl:8.10.1 -fs "http://$old:9090/" >/dev/null 2>&1 && break
  sleep 2
done

$compose run --rm --no-deps \
  -v "$(pwd)/tools/storage/migrate-s3mock.mjs:/app/migrate-s3mock.mjs:ro" \
  -e OLD_S3_ENDPOINT="http://$old:9090" \
  ocs node migrate-s3mock.mjs
