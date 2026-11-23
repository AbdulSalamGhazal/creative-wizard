CREATE TABLE "parent_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"name" text NOT NULL,
	"network" varchar(16) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "adset_name" text;--> statement-breakpoint
ALTER TABLE "parent_campaigns" ADD CONSTRAINT "parent_campaigns_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_campaigns" ADD CONSTRAINT "parent_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parent_campaigns_account_network_name_idx" ON "parent_campaigns" USING btree ("account_id","network","name");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_parent_id_parent_campaigns_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_account_parent_idx" ON "campaigns" USING btree ("account_id","parent_id");