CREATE TABLE "exclusion_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"kind" varchar(24) NOT NULL,
	"objective" varchar(16),
	"campaign_id" uuid,
	"creative_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"note" varchar(200),
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "excluded_source" varchar(8);--> statement-breakpoint
ALTER TABLE "performance_records" ADD COLUMN "excluded_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "include_excluded" boolean;--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exclusion_rules_account_objective_idx" ON "exclusion_rules" USING btree ("account_id","objective") WHERE "exclusion_rules"."kind" = 'campaign_objective';--> statement-breakpoint
CREATE UNIQUE INDEX "exclusion_rules_account_campaign_idx" ON "exclusion_rules" USING btree ("account_id","campaign_id") WHERE "exclusion_rules"."kind" = 'campaign';--> statement-breakpoint
CREATE UNIQUE INDEX "exclusion_rules_account_creative_idx" ON "exclusion_rules" USING btree ("account_id","creative_id") WHERE "exclusion_rules"."kind" = 'creative';--> statement-breakpoint
ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_excluded_rule_id_exclusion_rules_id_fk" FOREIGN KEY ("excluded_rule_id") REFERENCES "public"."exclusion_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perf_excluded_rule_idx" ON "performance_records" USING btree ("excluded_rule_id");--> statement-breakpoint
-- Backfill provenance: every row excluded before rules existed was excluded manually.
UPDATE "performance_records" SET "excluded_source" = 'manual' WHERE "excluded_from_aggregates" = true AND "excluded_source" IS NULL;