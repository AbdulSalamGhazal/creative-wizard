# Schema and migrations

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- Schema changes go through Drizzle migrations; **never edit a generated
  migration** — create a new one.
- `pgEnum` helpers map to plain `varchar`, so changing an allowed value set
  needs NO migration.
- Adding a `NOT NULL` column to a populated table needs a default or a
  backfill.
- A hand-written migration (a RENAME, a data fold) must never be regenerated.
- A DATA-ONLY migration (0062, the angle-vocabulary backfill) still gets a
  journal entry and a snapshot: copy the previous snapshot with a fresh `id`
  and `prevId` = the previous `id`, so `drizzle-kit generate` keeps its chain.
  Like every migration it does not run on deploy — run it by hand against the
  direct URL (CLAUDE.md, Deployment).
- **A column the OLD code doesn't write goes in as EXPAND → CONTRACT**
  (0023 / 0024; `parent_campaigns` + `parent_campaigns_reconcile`, then the
  contract `campaigns_parent_reconcile_final` + `campaigns_parent_not_null`
  one day later, 2026-11-24 — the reconcile re-run FIRST, in its own
  migration, so `SET NOT NULL` cannot meet a row the old code wrote in the
  gap; had one existed the migration would have failed whole and changed
  nothing). `drizzle-kit migrate` applies
  EVERY pending migration, and the code deployed before a migration keeps
  running until the deploy lands — so the expand step (nullable column + a
  backfill) ships with the code, and `SET NOT NULL` is its OWN later series,
  once a rollback is off the table. Until then the Drizzle column stays
  nullable and reads tolerate NULL. A backfill that derives a value from
  another column RECONCILES (rewrites a row whenever derived ≠ stored, not
  only when NULL — the old code may change the source column in the gap), is
  idempotent, and is pinned against the TS function it mirrors by a DB test
  that runs the migration file's own SQL.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### platform/type/status are varchar, not enums

<!-- was CLAUDE.md L513–516 -->

- **`platform`/`type`/`status` columns are `varchar`, NOT Postgres enums.** The
  Drizzle `pgEnum` helpers map to plain `varchar` columns (no DB-level enum
  type exists). So changing the allowed value set — e.g. the v2 `meta` →
  `instagram` + `facebook` split — needs only a code change, NO DB migration.

### NOT NULL on performance_records needs an empty table

<!-- was CLAUDE.md L517–520 -->

- **Adding a `NOT NULL` column to `performance_records` requires the table to
  be empty** (or a default/backfill). The v2 cutover added `campaign_name
  NOT NULL` (migration 0010), so prod performance data was cleared first
  (performance_records + upload_batches), keeping creatives/products/users.
