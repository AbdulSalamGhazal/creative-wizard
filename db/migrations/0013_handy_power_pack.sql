CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
-- Seed the default brand (Urjwan). Every existing row's account_id defaults to
-- this id, and the FK constraints below validate against it, so it must exist
-- before those run.
INSERT INTO "accounts" ("id", "name", "slug")
VALUES ('00000000-0000-0000-0000-000000000001', 'Urjwan', 'urjwan')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "creatives" DROP CONSTRAINT "creatives_name_unique";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_name_unique";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_slug_unique";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_name_unique";--> statement-breakpoint
DROP INDEX "pfm_unique_idx";--> statement-breakpoint
DROP INDEX "summary_views_owner_name_idx";--> statement-breakpoint
DROP INDEX "summary_views_default_idx";--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_field_mappings" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_views" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_batches" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_validation_sessions" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_field_mappings" ADD CONSTRAINT "platform_field_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_views" ADD CONSTRAINT "summary_views_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_validation_sessions" ADD CONSTRAINT "upload_validation_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creatives_account_name_idx" ON "creatives" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "perf_account_date_idx" ON "performance_records" USING btree ("account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "products_account_name_idx" ON "products" USING btree ("account_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "products_account_slug_idx" ON "products" USING btree ("account_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_account_name_idx" ON "tags" USING btree ("account_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pfm_unique_idx" ON "platform_field_mappings" USING btree ("account_id","platform","internal_field","header_name");--> statement-breakpoint
CREATE UNIQUE INDEX "summary_views_owner_name_idx" ON "summary_views" USING btree ("account_id","owner_user_id","page","name");--> statement-breakpoint
CREATE UNIQUE INDEX "summary_views_default_idx" ON "summary_views" USING btree ("account_id","page") WHERE "summary_views"."is_default";