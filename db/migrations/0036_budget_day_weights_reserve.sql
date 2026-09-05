CREATE TABLE "budget_day_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"month" date NOT NULL,
	"day" smallint NOT NULL,
	"weight" numeric(6, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_targets" ADD COLUMN "reserve_spend_usd" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_day_weights" ADD CONSTRAINT "budget_day_weights_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_day_weights_account_month_day_idx" ON "budget_day_weights" USING btree ("account_id","month","day");