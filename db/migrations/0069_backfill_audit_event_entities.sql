-- 2026-11 audit → entity links backfill (DATA-ONLY, hand-written — never
-- regenerate; `drizzle-kit generate` has nothing to say about data).
--
-- From now on every audit write names the creatives, campaigns and budget
-- months it touched (`writeAudit({ touches })`, lib/audit.ts). This links the
-- events written BEFORE that, as far as the stored rows still allow:
--
--   1. an event ON a creative / campaign            → itself
--   2. budget.update on a month (`entity_id` = YYYY-MM-01) → that month
--   3. exclusion.exclude / .include                 → `meta.creativeId`
--   4. upload.commit                                 → the creatives, campaigns
--      and months of the batch's SURVIVING records
--
-- What is NOT recoverable, and stays unlinked (it shows in the brand-wide
-- audit feed, just not in an entity's history): a rollback's, a cleanup's and
-- a campaign/creative delete's OTHER side (the records are gone — those rows
-- stored counts, names or filters, never ids); an exclusion rule's sweep
-- (counts only; a deleted rule lost its target too); an angle rename/delete
-- (a count); a bulk create (names, which may since have been renamed or
-- reused); a commit's records deleted since; an upsert commit's UPDATED rows
-- (they belong to earlier batches). An exclusion's campaign was never stored,
-- so old exclusions link to their creative only.
--
-- Idempotent: every insert is ON CONFLICT DO NOTHING on the link's unique
-- (audit_event_id, entity_type, entity_id), so a re-run adds nothing.

-- 1. Entity-direct events link themselves.
INSERT INTO "audit_event_entities" ("audit_event_id", "account_id", "entity_type", "entity_id")
SELECT ae."id", ae."account_id", ae."entity_type", ae."entity_id"
FROM "audit_events" ae
WHERE ae."entity_type" IN ('creative', 'campaign')
  AND ae."entity_id" IS NOT NULL AND ae."entity_id" <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. A budget-plan event links its month.
INSERT INTO "audit_event_entities" ("audit_event_id", "account_id", "entity_type", "entity_id")
SELECT ae."id", ae."account_id", 'budget_month', substr(ae."entity_id", 1, 7)
FROM "audit_events" ae
WHERE ae."action" = 'budget.update'
  AND ae."entity_id" ~ '^\d{4}-(0[1-9]|1[0-2])'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. A manual exclusion links its record's creative.
INSERT INTO "audit_event_entities" ("audit_event_id", "account_id", "entity_type", "entity_id")
SELECT ae."id", ae."account_id", 'creative', ae."meta" ->> 'creativeId'
FROM "audit_events" ae
WHERE ae."action" IN ('exclusion.exclude', 'exclusion.include')
  AND coalesce(ae."meta" ->> 'creativeId', '') <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4. A commit links what its batch's surviving records belong to. The text
--    comparison (not a ::uuid cast) keeps a malformed entity_id from failing
--    the whole migration; the account match keeps it inside the brand.
INSERT INTO "audit_event_entities" ("audit_event_id", "account_id", "entity_type", "entity_id")
SELECT DISTINCT ae."id", ae."account_id", t."entity_type", t."entity_id"
FROM "audit_events" ae
JOIN "upload_batches" ub
  ON ub."id"::text = ae."entity_id" AND ub."account_id" = ae."account_id"
JOIN "performance_records" pr
  ON pr."upload_batch_id" = ub."id" AND pr."account_id" = ae."account_id"
CROSS JOIN LATERAL (
  VALUES
    ('creative', pr."creative_id"::text),
    ('campaign', pr."campaign_id"::text),
    ('budget_month', to_char(pr."date", 'YYYY-MM'))
) AS t("entity_type", "entity_id")
WHERE ae."action" = 'upload.commit'
ON CONFLICT DO NOTHING;
