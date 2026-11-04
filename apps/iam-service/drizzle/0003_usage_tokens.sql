-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: 2026 VKU.VIC
-- AI/inference token metering (#26).
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "prompt_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "completion_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "total_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_model_time" ON "usage_events" USING btree ("model","created_at" DESC NULLS LAST);
