-- Budget plan modes (additive). A month is planned EITHER by the curve system
-- (unchanged) OR by explicit day-grain cells uploaded from a sheet.
--  - budget_plan_days: the daily-mode cells (day × platform × bucket, USD).
--    The unique index leads with (account_id, month), so it serves the
--    month read too.
--  - budget_targets.plan_mode: 'curve' | 'daily' (app-side enum); DEFAULT
--    'curve', so every existing month is a curve month — NO backfill.
--  - budget_targets.target_roas: the daily-mode revenue link, NULL in curve.
CREATE TABLE "budget_plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"month" date NOT NULL,
	"day" smallint NOT NULL,
	"platform" varchar(16) NOT NULL,
	"objective" varchar(16) NOT NULL,
	"planned_spend" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_targets" ADD COLUMN "plan_mode" varchar(8) DEFAULT 'curve' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_targets" ADD COLUMN "target_roas" numeric(14, 8);--> statement-breakpoint
ALTER TABLE "budget_plan_days" ADD CONSTRAINT "budget_plan_days_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_plan_days_account_month_day_combo_idx" ON "budget_plan_days" USING btree ("account_id","month","day","platform","objective");