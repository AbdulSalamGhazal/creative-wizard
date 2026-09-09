CREATE TABLE "budget_plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"month" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text,
	"saved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_plan_revisions" ADD CONSTRAINT "budget_plan_revisions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plan_revisions" ADD CONSTRAINT "budget_plan_revisions_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_plan_revisions_account_month_created_idx" ON "budget_plan_revisions" USING btree ("account_id","month","created_at" DESC NULLS LAST);