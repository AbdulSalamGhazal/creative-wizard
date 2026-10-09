-- Remembered table columns (additive) — one table, nothing else touched.
-- The sibling of `user_filter_prefs`: one row per (user, brand, table), holding
-- the columns that are OFF (`hidden` — absent means visible, so a column added
-- later shows up for everyone) and the non-pinned column order (`col_order`,
-- merged against the live config on read). `table_key` is validated against the
-- TABLE_KEYS registry in lib/table-columns.ts before any write. Reset deletes
-- the row, which is what stops a preference resurrecting itself.
CREATE TABLE "user_table_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"table_key" varchar(48) NOT NULL,
	"hidden" text[] NOT NULL,
	"col_order" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_table_prefs" ADD CONSTRAINT "user_table_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_table_prefs" ADD CONSTRAINT "user_table_prefs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_table_prefs_user_account_table_idx" ON "user_table_prefs" USING btree ("user_id","account_id","table_key");