-- 2026-09 tag → angle rename (NON-ADDITIVE, hand-written).
--
-- The creative-labeling concept "tag" is renamed "angle" at every layer. This
-- file is authored BY HAND on purpose: `drizzle-kit generate` emits DROP+CREATE
-- for a table rename, which would destroy every assignment. RENAME preserves
-- all rows, so no backfill is needed.
--
-- DEPLOY ORDERING: old code breaks after this migration and new code breaks
-- before it. Push → let the Vercel build COMPLETE → run this immediately.
--
-- NOTE: `ALTER TABLE ... RENAME TO` does NOT rename the table's indexes or
-- constraints, so each is renamed explicitly below to keep the DB's names in
-- step with what Drizzle's schema/snapshot expect.

ALTER TABLE "tags" RENAME TO "angles";--> statement-breakpoint
ALTER TABLE "creative_tags" RENAME TO "creative_angles";--> statement-breakpoint
ALTER TABLE "creative_angles" RENAME COLUMN "tag" TO "angle";--> statement-breakpoint

-- angles (was tags): primary key, unique (account, name), both FKs.
ALTER INDEX "tags_pkey" RENAME TO "angles_pkey";--> statement-breakpoint
ALTER INDEX "tags_account_name_idx" RENAME TO "angles_account_name_idx";--> statement-breakpoint
ALTER TABLE "angles" RENAME CONSTRAINT "tags_account_id_accounts_id_fk" TO "angles_account_id_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "angles" RENAME CONSTRAINT "tags_created_by_user_id_users_id_fk" TO "angles_created_by_user_id_users_id_fk";--> statement-breakpoint

-- creative_angles (was creative_tags): composite PK, the angle index, the FK.
ALTER INDEX "creative_tags_creative_id_tag_pk" RENAME TO "creative_angles_creative_id_angle_pk";--> statement-breakpoint
ALTER INDEX "creative_tags_tag_idx" RENAME TO "creative_angles_angle_idx";--> statement-breakpoint
ALTER TABLE "creative_angles" RENAME CONSTRAINT "creative_tags_creative_id_creatives_id_fk" TO "creative_angles_creative_id_creatives_id_fk";--> statement-breakpoint

-- Stored permission strings: the granular key `catalog.tags` becomes
-- `catalog.angles`. Only users with an EXPLICIT (non-null) permission array are
-- affected — role presets derive from the catalog in code and follow for free.
-- Without this, a custom-permission user would silently lose angle management.
UPDATE "users"
SET "permissions" = array_replace("permissions", 'catalog.tags', 'catalog.angles')
WHERE "permissions" IS NOT NULL
  AND 'catalog.tags' = ANY("permissions");--> statement-breakpoint

-- Saved views pin their filters as a URL-encoded query STRING
-- (summary_views.query, from URLSearchParams.toString()), not jsonb — so the
-- filter appears as a `tags=` PARAM KEY. Rewrite the key only; the values are
-- angle names and are unchanged (no decoding needed, and no dedupe: renaming a
-- key can't collide the way the 0034 objective merge could). Anchoring on
-- (^|&) means a param merely ENDING in "tags" is left alone.
UPDATE "summary_views"
SET "query" = regexp_replace("query", '(^|&)tags=', '\1angles=')
WHERE "query" ~ '(^|&)tags=';
