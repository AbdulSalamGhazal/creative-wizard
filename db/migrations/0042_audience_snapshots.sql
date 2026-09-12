CREATE TABLE "audience_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"platform" varchar(16) NOT NULL,
	"stage" varchar(16) NOT NULL,
	"date" date NOT NULL,
	"size" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_snapshots_size_non_negative" CHECK ("audience_snapshots"."size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audience_snapshots" ADD CONSTRAINT "audience_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_snapshots" ADD CONSTRAINT "audience_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_snapshots_account_platform_stage_date_idx" ON "audience_snapshots" USING btree ("account_id","platform","stage","date");--> statement-breakpoint
CREATE INDEX "audience_snapshots_account_date_idx" ON "audience_snapshots" USING btree ("account_id","date");