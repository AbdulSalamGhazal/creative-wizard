DROP INDEX "perf_creative_platform_campaign_date_idx";--> statement-breakpoint
DROP INDEX "perf_account_campaign_date_idx";--> statement-breakpoint
-- Safety net: backfill any row that somehow still lacks campaign_id (none
-- expected after 0023) from the registry BEFORE enforcing NOT NULL —
-- campaign_name still exists at this point.
UPDATE "performance_records" pr
SET "campaign_id" = c."id"
FROM "campaigns" c
WHERE pr."campaign_id" IS NULL
  AND c."account_id" = pr."account_id"
  AND c."name" = pr."campaign_name";--> statement-breakpoint
ALTER TABLE "performance_records" ALTER COLUMN "campaign_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_records" DROP COLUMN "campaign_name";