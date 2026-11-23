-- DATA-ONLY, hand-written — never regenerate.
--
-- Give every ad set (a `campaigns` row) its CAMPAIGN (`parent_campaigns`) and
-- its own `adset_name`, derived from the stored name exactly as
-- `parseCampaignName` (lib/campaign.ts) reads it:
--   1. strip ONE trailing platform tag, only for its own platform
--      (" (IG)" on instagram, " (FB)" on facebook);
--   2. the campaign is the text before the FIRST " ➤ ", the ad set is
--      everything after it ('' when there is no separator);
--   3. nothing is trimmed.
-- The network is the platform, with instagram and facebook folded into `meta`.
--
-- IDEMPOTENT, and it RECONCILES — a row is rewritten whenever its derived
-- value differs from the stored one, not only when it is NULL — because the
-- code deployed before this migration renames an ad set without touching
-- these two columns. Safe to run again at any time (the contract migration
-- repeats it): for a row the app wrote, derived = stored.
INSERT INTO "parent_campaigns" ("account_id", "network", "name", "created_by_user_id", "created_at")
SELECT d."account_id", d.network, d.camp,
       (array_agg(d."created_by_user_id" ORDER BY d."created_at", d."id"))[1],
       MIN(d."created_at")
FROM (
  SELECT b."id", b."account_id", b."created_by_user_id", b."created_at",
         CASE WHEN b."platform" IN ('instagram', 'facebook') THEN 'meta' ELSE b."platform" END AS network,
         CASE WHEN position(' ➤ ' IN b.base) > 0
              THEN left(b.base, position(' ➤ ' IN b.base) - 1)
              ELSE b.base END AS camp
  FROM (
    SELECT c.*,
           CASE WHEN c."platform" = 'instagram' AND right(c."name", 5) = ' (IG)' THEN left(c."name", length(c."name") - 5)
                WHEN c."platform" = 'facebook' AND right(c."name", 5) = ' (FB)' THEN left(c."name", length(c."name") - 5)
                ELSE c."name" END AS base
    FROM "campaigns" c
  ) b
) d
GROUP BY d."account_id", d.network, d.camp
ON CONFLICT ("account_id", "network", "name") DO NOTHING;
--> statement-breakpoint
UPDATE "campaigns" c
SET "parent_id" = p."id", "adset_name" = d.adset
FROM (
  SELECT b."id", b."account_id",
         CASE WHEN b."platform" IN ('instagram', 'facebook') THEN 'meta' ELSE b."platform" END AS network,
         CASE WHEN position(' ➤ ' IN b.base) > 0
              THEN left(b.base, position(' ➤ ' IN b.base) - 1)
              ELSE b.base END AS camp,
         CASE WHEN position(' ➤ ' IN b.base) > 0
              THEN substr(b.base, position(' ➤ ' IN b.base) + 3)
              ELSE '' END AS adset
  FROM (
    SELECT c2."id", c2."account_id", c2."platform",
           CASE WHEN c2."platform" = 'instagram' AND right(c2."name", 5) = ' (IG)' THEN left(c2."name", length(c2."name") - 5)
                WHEN c2."platform" = 'facebook' AND right(c2."name", 5) = ' (FB)' THEN left(c2."name", length(c2."name") - 5)
                ELSE c2."name" END AS base
    FROM "campaigns" c2
  ) b
) d
JOIN "parent_campaigns" p
  ON p."account_id" = d."account_id" AND p."network" = d.network AND p."name" = d.camp
WHERE c."id" = d."id"
  AND (c."parent_id" IS DISTINCT FROM p."id" OR c."adset_name" IS DISTINCT FROM d.adset);
