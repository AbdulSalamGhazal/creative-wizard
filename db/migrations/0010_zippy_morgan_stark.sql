ALTER TABLE "performance_records" ADD COLUMN "campaign_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "landing_page_views" integer;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "video_views_2s" integer;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "video_views_25" integer;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "video_views_50" integer;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "video_views_75" integer;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "video_views_100" integer;