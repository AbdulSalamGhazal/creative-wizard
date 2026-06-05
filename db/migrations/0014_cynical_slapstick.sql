-- Multi-tenancy slice 6: make the rating config per-account.
-- rating_rules: was a global singleton (id = 1) → one row per account (PK = account_id).
-- platform_rating_rules: was keyed on platform → keyed on (account_id, platform).
--
-- Order matters: add the account_id columns (DEFAULT backfills every existing
-- row to Urjwan) BEFORE swapping the primary keys. The Urjwan account already
-- exists (created in 0013), so the FKs validate.

-- 1. Add account_id columns (NOT NULL DEFAULT Urjwan → existing rows backfill).
ALTER TABLE "rating_rules" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_rating_rules" ADD COLUMN "account_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint

-- 2. Drop the old primary keys (auto-named <table>_pkey by Postgres).
ALTER TABLE "rating_rules" DROP CONSTRAINT "rating_rules_pkey";--> statement-breakpoint
ALTER TABLE "platform_rating_rules" DROP CONSTRAINT "platform_rating_rules_pkey";--> statement-breakpoint

-- 3. Drop the now-unused singleton id column on rating_rules.
ALTER TABLE "rating_rules" DROP COLUMN "id";--> statement-breakpoint

-- 4. Add the new account-scoped primary keys.
ALTER TABLE "rating_rules" ADD CONSTRAINT "rating_rules_account_id_pk" PRIMARY KEY("account_id");--> statement-breakpoint
ALTER TABLE "platform_rating_rules" ADD CONSTRAINT "platform_rating_rules_account_id_platform_pk" PRIMARY KEY("account_id","platform");--> statement-breakpoint

-- 5. Add the FKs to accounts.
ALTER TABLE "rating_rules" ADD CONSTRAINT "rating_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_rating_rules" ADD CONSTRAINT "platform_rating_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
