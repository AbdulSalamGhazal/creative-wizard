-- 2026-09 objective merge (DATA migration, no schema change):
-- "Reach&Freq" / "Traffic" / "Video Views" are retired; everything carrying one
-- becomes "Awareness". "Activation" is new (no existing rows). The objective
-- column is a plain varchar (no DB enum), so this is pure UPDATEs. Global
-- vocabulary → all accounts on purpose.

UPDATE "campaigns"
SET "objective" = 'Awareness'
WHERE "objective" IN ('Reach&Freq', 'Traffic', 'Video Views');--> statement-breakpoint

-- Exclusion rules targeting a retired objective follow the rename. All rules
-- were deleted before this migration, so this is expected to touch 0 rows. If
-- somehow two rules for the same account both map onto 'Awareness', the
-- per-kind unique index (exclusion_rules_account_objective_idx) aborts the
-- whole migration loudly — transactional, nothing half-applied. That is the
-- intended failure mode: resolve the duplicate rules, then re-run.
UPDATE "exclusion_rules"
SET "objective" = 'Awareness'
WHERE "kind" = 'campaign_objective'
  AND "objective" IN ('Reach&Freq', 'Traffic', 'Video Views');--> statement-breakpoint

-- Saved views for the Campaigns page can pin an objectives filter. The config
-- is a URL-encoded query STRING (summary_views.query, saved via
-- URLSearchParams.toString()), NOT jsonb — so the retired values appear inside
-- the objectives= param as 'Reach%26Freq', 'Traffic', 'Video+Views' (or
-- 'Video%20Views'), joined by '%2C'. Tokenize just that param, map retired
-- values to 'Awareness', dedupe within the list (string_agg DISTINCT; token
-- order in a CSV filter is irrelevant), and splice the param back. Rows whose
-- objectives value is empty/absent are untouched.
WITH target AS (
  SELECT id, (regexp_match(query, '(?:^|&)objectives=([^&]*)'))[1] AS objs
  FROM summary_views
  WHERE page = 'campaigns' AND query ~ '(?:^|&)objectives=[^&]'
),
mapped AS (
  SELECT
    t.id,
    t.objs,
    (
      SELECT string_agg(DISTINCT CASE
        WHEN tok IN ('Reach%26Freq', 'Traffic', 'Video+Views', 'Video%20Views')
          THEN 'Awareness'
        ELSE tok
      END, '%2C')
      FROM unnest(string_to_array(t.objs, '%2C')) AS tok
    ) AS new_objs
  FROM target t
)
UPDATE summary_views sv
SET query = regexp_replace(sv.query, '(^|&)objectives=[^&]*', '\1objectives=' || m.new_objs)
FROM mapped m
WHERE sv.id = m.id
  AND m.new_objs IS NOT NULL
  AND m.new_objs IS DISTINCT FROM m.objs;
