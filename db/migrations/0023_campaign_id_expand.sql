ALTER TABLE "performance_records" ALTER COLUMN "campaign_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
-- Backfill campaign_id from the campaigns registry by (account_id, campaign_name).
-- Every campaign_name was backfilled into the registry + E061 enforces it, so
-- this resolves every existing row (verified by the 0-orphan post-check).
UPDATE "performance_records" pr
SET "campaign_id" = c."id"
FROM "campaigns" c
WHERE c."account_id" = pr."account_id"
  AND c."name" = pr."campaign_name"
  AND pr."campaign_id" IS NULL;--> statement-breakpoint
ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perf_creative_platform_campaign_id_date_idx" ON "performance_records" USING btree ("creative_id","platform","campaign_id","date");--> statement-breakpoint
CREATE INDEX "perf_account_campaign_id_date_idx" ON "performance_records" USING btree ("account_id","campaign_id","date");