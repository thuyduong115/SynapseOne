-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: 2026 VKU.VIC
-- SynapseBase Postgres query pushdown indexes (#29).
--
-- The text helper extracts only string values from a document (keys are not
-- indexed), so `$text` searches do not match field names. It is IMMUTABLE so
-- it can back a GIN expression index.
CREATE OR REPLACE FUNCTION synapseone_base_doc_text(doc jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(string_agg(v #>> '{}', ' '), '')
  FROM jsonb_path_query(doc, '$.**') AS v
  WHERE jsonb_typeof(v) = 'string';
$$;
--> statement-breakpoint
-- Real full-text index for the `$text` operator (plainto_tsquery('simple', …)).
CREATE INDEX IF NOT EXISTS "idx_base_documents_fts"
  ON "synapseone_base_documents"
  USING gin (to_tsvector('simple', synapseone_base_doc_text("data")));
--> statement-breakpoint
-- Ordering by document timestamps is a common product query; the primary key
-- already covers the default (collection_id, id) order.
CREATE INDEX IF NOT EXISTS "idx_base_documents_created"
  ON "synapseone_base_documents" USING btree ("collection_id","created_at");
