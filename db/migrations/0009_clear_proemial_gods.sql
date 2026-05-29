DROP INDEX "perf_creative_platform_date_idx";--> statement-breakpoint
CREATE INDEX "perf_creative_platform_date_idx" ON "performance_records" USING btree ("creative_id","platform","date");