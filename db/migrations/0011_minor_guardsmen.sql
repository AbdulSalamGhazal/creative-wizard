DROP INDEX "perf_creative_platform_date_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "perf_creative_platform_campaign_date_idx" ON "performance_records" USING btree ("creative_id","platform","campaign_name","date");--> statement-breakpoint
ALTER TABLE "performance_records" DROP COLUMN "video_views_3s";--> statement-breakpoint
ALTER TABLE "performance_records" DROP COLUMN "video_views_15s";