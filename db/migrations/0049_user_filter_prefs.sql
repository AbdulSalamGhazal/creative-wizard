-- Filter preferences (additive) — the date range's behaviour, generalized.
-- One row per (user, brand, filter key); `values` holds the URL param's parts.
-- Per brand by design, and a CLEARED filter deletes its row rather than
-- storing an empty set, which is what stops a filter resurrecting.
CREATE TABLE "user_filter_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"filter_key" varchar(32) NOT NULL,
	"values" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_filter_prefs" ADD CONSTRAINT "user_filter_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_filter_prefs" ADD CONSTRAINT "user_filter_prefs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_filter_prefs_user_account_key_idx" ON "user_filter_prefs" USING btree ("user_id","account_id","filter_key");