ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_uq" ON "users" USING btree ("email") WHERE "users"."removed_at" IS NULL;--> statement-breakpoint
-- 2026-11-06 backfill (DATA-ONLY, appended by hand to the generated DDL above —
-- `drizzle-kit generate` has nothing to say about data). "Last sign-in" is new
-- on the Team page; every successful sign-in has been audited as `auth.signin`
-- with the user's id as `entity_id` since the audit trail began, so existing
-- members start with their real last sign-in instead of "Never". Idempotent:
-- only NULL rows are touched, and a stamp from the code path wins thereafter.
UPDATE "users" AS u
SET "last_sign_in_at" = s."at"
FROM (
  SELECT "entity_id", MAX("at") AS "at"
  FROM "audit_events"
  WHERE "action" = 'auth.signin' AND "entity_id" IS NOT NULL
  GROUP BY "entity_id"
) AS s
WHERE u."id"::text = s."entity_id" AND u."last_sign_in_at" IS NULL;
