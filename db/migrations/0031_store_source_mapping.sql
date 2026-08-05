CREATE TABLE "store_source_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"raw_value" varchar(128) NOT NULL,
	"platform" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "store_source_field_key" varchar(48);--> statement-breakpoint
ALTER TABLE "store_source_mappings" ADD CONSTRAINT "store_source_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_source_mappings_account_raw_idx" ON "store_source_mappings" USING btree ("account_id","raw_value");