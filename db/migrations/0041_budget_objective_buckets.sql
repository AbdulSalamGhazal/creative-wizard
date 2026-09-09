-- 2026-09 Budget objective buckets (DATA migration, no schema change).
--
-- Budget now plans against its OWN objective axis — Awareness / Activation /
-- Retargeting / Other — instead of the campaign vocabulary. Everything that is
-- not one of the three mains (Sales, Prospecting, Special Case, and anything a
-- future campaign rename introduces) folds into 'Other'.
--
-- Folding can collide: a platform planned separately for Sales and Prospecting
-- in the same month becomes ONE 'Other' row, and the unique index
-- (account_id, month, platform, objective) would refuse a second. So the
-- amounts are SUMMED per (account_id, month, platform) — no money is lost, and
-- the month's planned total is unchanged.
--
-- The objective column is a plain varchar (no DB enum), so this is pure DML.
-- Done in three steps rather than one data-modifying CTE because Postgres does
-- not order a CTE's DELETE against the outer INSERT: a pre-existing 'Other'
-- row could still be present when the summed row is inserted, and the unique
-- index would abort. Staging the totals first makes the order explicit.

CREATE TEMP TABLE "budget_objective_fold" AS
SELECT
  "account_id",
  "month",
  "platform",
  SUM("planned_spend") AS "planned_spend"
FROM "budget_allocations"
WHERE "objective" NOT IN ('Awareness', 'Activation', 'Retargeting')
GROUP BY "account_id", "month", "platform";--> statement-breakpoint

DELETE FROM "budget_allocations"
WHERE "objective" NOT IN ('Awareness', 'Activation', 'Retargeting');--> statement-breakpoint

INSERT INTO "budget_allocations" ("account_id", "month", "platform", "objective", "planned_spend")
SELECT "account_id", "month", "platform", 'Other', "planned_spend"
FROM "budget_objective_fold";--> statement-breakpoint

DROP TABLE "budget_objective_fold";
