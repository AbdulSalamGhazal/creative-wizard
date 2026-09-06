-- 2026-09 rollback safety (ADDITIVE, no backfill).
--
-- `updated_at` is written ONLY by the ads upsert UPDATE path
-- (`bulkUpdateMetricValues`). Existing rows stay NULL, which reads as "never
-- overwritten since import" — exactly the right default, since nothing before
-- this migration recorded an overwrite.
--
-- Rolling back a batch deletes its rows outright. When a LATER upsert has since
-- revised some of them, that also discards the newer values; the confirm dialog
-- now counts those rows (updated_at > the batch's own uploaded_at) and warns.
-- Nullable + no default, so the migration is instant on a large table.

ALTER TABLE "performance_records" ADD COLUMN "updated_at" timestamp with time zone;
