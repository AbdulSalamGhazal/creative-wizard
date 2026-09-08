-- 2026-09 performance pass: indexes matching how the app actually reads
-- (ADDITIVE apart from two index drops; no data is touched).
--
-- LOCKING: plain CREATE INDEX takes a SHARE lock — writes to the table block
-- for the duration, reads do not. At the current table size that is a blip and
-- acceptable. If performance_records ever grows to where that matters, switch
-- to CREATE INDEX CONCURRENTLY, which cannot run inside a transaction and so
-- would need running by hand outside drizzle-kit.
--
-- Creates come BEFORE the drops so there is never a moment with neither index.

-- Nearly every read is account-scoped, non-excluded, real spend: that predicate
-- is the aggregate default (CLAUDE.md Aggregation rules) and the status scans'
-- `spend > 0`. PARTIAL indexes on it hold only the rows those queries can
-- return, so they stay far smaller than the table and the DESC ordering lets
-- the planner skip a sort.
CREATE INDEX "perf_account_platform_date_active_idx" ON "performance_records" USING btree ("account_id","platform","date" DESC NULLS LAST) WHERE "performance_records"."spend" > 0 AND "performance_records"."excluded_from_aggregates" = false;--> statement-breakpoint
CREATE INDEX "perf_account_creative_platform_date_active_idx" ON "performance_records" USING btree ("account_id","creative_id","platform","date") WHERE "performance_records"."spend" > 0 AND "performance_records"."excluded_from_aggregates" = false;--> statement-breakpoint

-- The Orders page searches order_id by SUBSTRING (ILIKE '%…%'), which a b-tree
-- can't serve at all. pg_trgm + GIN turns that into an index scan. The
-- extension is idempotent and safe to create on an existing database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "store_orders_order_id_trgm_idx" ON "store_orders" USING gin ("order_id" gin_trgm_ops);--> statement-breakpoint

-- Both of these are now redundant and were verified (by grep over the whole
-- repo) to have no dependants outside schema.ts and historical snapshots:
--   perf_date_idx      — a bare (date) index; every real query also filters
--                        account_id, so perf_account_date_idx serves them and
--                        this one only cost write throughput.
--   perf_excluded_idx  — a bare (excluded_from_aggregates) boolean index. Two
--                        distinct values over a large table is not selective
--                        enough for the planner to choose it, and the new
--                        partial indexes encode the same predicate usefully.
DROP INDEX "perf_date_idx";--> statement-breakpoint
DROP INDEX "perf_excluded_idx";
