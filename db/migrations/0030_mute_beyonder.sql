CREATE TABLE "store_order_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"key" varchar(48) NOT NULL,
	"label" varchar(64) NOT NULL,
	"type" varchar(8) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"show_in_table" boolean DEFAULT true NOT NULL,
	"headers" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"order_id" varchar(64) NOT NULL,
	"order_date" date NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"upload_batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_upload_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"upsert" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"rolled_back_at" timestamp with time zone,
	"rolled_back_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "store_order_fields" ADD CONSTRAINT "store_order_fields_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_upload_batch_id_store_upload_batches_id_fk" FOREIGN KEY ("upload_batch_id") REFERENCES "public"."store_upload_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_upload_batches" ADD CONSTRAINT "store_upload_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_upload_batches" ADD CONSTRAINT "store_upload_batches_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_upload_batches" ADD CONSTRAINT "store_upload_batches_rolled_back_by_user_id_users_id_fk" FOREIGN KEY ("rolled_back_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_order_fields_account_key_idx" ON "store_order_fields" USING btree ("account_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_account_order_idx" ON "store_orders" USING btree ("account_id","order_id");--> statement-breakpoint
CREATE INDEX "store_orders_account_date_idx" ON "store_orders" USING btree ("account_id","order_date");--> statement-breakpoint
CREATE INDEX "store_orders_batch_idx" ON "store_orders" USING btree ("upload_batch_id");--> statement-breakpoint
CREATE INDEX "store_upload_batches_account_uploaded_idx" ON "store_upload_batches" USING btree ("account_id","uploaded_at" DESC NULLS LAST);--> statement-breakpoint
-- Seed the three locked CORE fields for every EXISTING account (new accounts
-- get them via createAccount). Core fields are always required + shown; only
-- their label + headers are editable (enforced in code via CORE_KEYS).
INSERT INTO "store_order_fields" ("account_id", "key", "label", "type", "required", "show_in_table", "headers", "sort_order")
SELECT a."id", f."key", f."label", f."type", true, true, '{}'::text[], f."sort_order"
FROM "accounts" a
CROSS JOIN (VALUES
  ('order_id', 'Order ID', 'text', 0),
  ('order_date', 'Order date', 'date', 1),
  ('total_amount', 'Total amount', 'number', 2)
) AS f("key", "label", "type", "sort_order");
