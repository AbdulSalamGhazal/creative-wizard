CREATE TABLE "landing_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(200),
	"url" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "perf_creative_platform_campaign_id_date_idx";--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "landing_page_id" uuid;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "landing_pages_account_code_idx" ON "landing_pages" USING btree ("account_id","code");--> statement-breakpoint
ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_landing_page_id_landing_pages_id_fk" FOREIGN KEY ("landing_page_id") REFERENCES "public"."landing_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perf_landing_page_idx" ON "performance_records" USING btree ("landing_page_id");--> statement-breakpoint
ALTER TABLE "performance_records" ADD CONSTRAINT "perf_identity_uq" UNIQUE NULLS NOT DISTINCT("creative_id","platform","campaign_id","date","landing_page_id");