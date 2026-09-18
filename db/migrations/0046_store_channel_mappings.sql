CREATE TABLE "store_channel_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"raw_value" varchar(128) NOT NULL,
	"destination" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_channel_mappings" ADD CONSTRAINT "store_channel_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_channel_mappings_account_raw_idx" ON "store_channel_mappings" USING btree ("account_id","raw_value");
--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────
-- DATA: the system-required field tier (utm_source + channel), per account.
--
-- The FIRST store migration that updates existing config rows, so every
-- statement below is idempotent and account-safe: re-running changes nothing,
-- and each account is seeded only where it lacks the field.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. PROMOTE an existing field to the tier — keeping its label and headers.
--    A store that already calls it "Source (UTM)" with its own header list
--    keeps both; only `required` is forced on.
UPDATE "store_order_fields"
SET "required" = true, "updated_at" = now()
WHERE "key" IN ('utm_source', 'channel') AND "required" = false;
--> statement-breakpoint

-- 2. SEED the field for every account that doesn't have it yet.
INSERT INTO "store_order_fields" ("account_id", "key", "label", "type", "required", "headers", "sort_order")
SELECT a."id", v."key", v."label", 'text', true, v."headers", v."sort_order"
FROM "accounts" a
CROSS JOIN (
  VALUES
    ('utm_source', 'UTM source', ARRAY['utm_source', 'utm source'], 3),
    ('channel',    'Channel',    ARRAY['channel'],                  4)
) AS v("key", "label", "headers", "sort_order")
WHERE NOT EXISTS (
  SELECT 1 FROM "store_order_fields" f
  WHERE f."account_id" = a."id" AND f."key" = v."key"
);
--> statement-breakpoint

-- 3. PIN the attribution source. The picker is retired: utm_source is the only
--    source field now. The column is kept (additive-only rule) and backfilled,
--    but the code no longer reads it — see STORE_SOURCE_FIELD_KEY.
UPDATE "accounts"
SET "store_source_field_key" = 'utm_source'
WHERE "store_source_field_key" IS DISTINCT FROM 'utm_source';
