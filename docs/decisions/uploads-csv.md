# The upload pipeline (CSV/XLSX)

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- The pipeline is 5 stages, in order; stages 1–2 fail fast, 3–5 collect; and
  **all-or-nothing** — nothing is written unless the whole file is clean.
- Matching is **trim-then-exact** (case-sensitive, no NFC); blank/`-`/`N/A`
  numeric cells read as **0**; E042 is for blank IDENTITY fields only, and a
  missing required column is E010. This is a decision, not a bug.
- **CSV or XLSX through ONE conversion layer** — nothing downstream may branch
  on the format. SheetJS is the reader; never add a second one.
- COUNT metrics round to the nearest whole number at NORMALIZATION and say so
  (W004); which fields are counts is declared once in `FIELD_META.kind`.
- Adding an internal field means all five places; the mapping UI DERIVES from
  `FIELD_LIST`/`FIELD_META` — never re-list fields in a component.
- Upsert reuses the import validation (so the file must carry all mapped
  columns) and its UPDATES are not rollback-able.
- `performance_records` has exactly four sanctioned exit paths; no other code
  deletes from it.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Forgiving CSV matching is intentional

<!-- was CLAUDE.md L469–477 -->

- **Forgiving CSV matching is INTENTIONAL as of 2026-07 (validation-spec v1.2).**
  The pipeline trims cells then matches creative names byte-exactly (case-
  sensitive, no NFC), and reads blank/`-`/`—`/`N/A`/`null` numeric cells as `0`
  in every numeric column (E042 is for blank identity fields — date/campaign_
  name/adset_name — only; a missing required column is E010). This was a
  deliberated product decision, NOT a bug — do **not** "fix" `csv/pipeline.ts`
  back to strict-with-NFC or make blank numeric cells raise E042. The spec was
  amended to match the code (not the reverse).


### The admin record-cleanup tool

<!-- was CLAUDE.md L507–512 -->

- The admin record-cleanup tool (`/uploads`, `app/actions/cleanup.ts`) is a
  sanctioned hard-delete exit path for `performance_records`, added at the
  user's request. It overrides the original "rollback is the only exit path"
  rule. Gated by the `upload.cleanup` permission. Guardrails: ≥1
  filter required, preview-then-confirm, audit-logged. Keep these whenever
  touching cleanup.

### Upload UPSERT mode

<!-- was CLAUDE.md L680–695 -->

- **Upload UPSERT mode** (the New-upload `upsert` toggle). The normal
  import (`runPipeline`) still defaults to strict insert: a row already in the
  DB → E051 reject (guards against re-uploading the wrong file). With the
  toggle ON, the validate route runs the SAME full validation but skips the
  E051 check, then partitions the validated rows against the table's unique
  identity `(creative, platform, campaign ➤ adset, date)` into **inserts**
  (new) and **updates** (existing, by record id). The commit inserts the new
  rows under one batch and UPDATEs the existing rows in place (full-row,
  last-value-wins; video columns null for non-video). Built for TikTok-style
  attribution backfill — re-upload the rolling window each day, existing days
  get their back-attributed conversions, the newest day is inserted. Because
  upsert reuses the import validation, the file must carry ALL mapped columns
  (a full export), not a partial one. Updates overwrite in place, so they're
  NOT rollback-able like an insert batch (the batch-rollback only undoes the
  inserted rows). Audit: `upload.commit` with meta `{rowsImported, rowsUpdated,
  upsert:true}`.

### CSV internal fields have one source of truth

<!-- was CLAUDE.md L819–833 -->

- **CSV internal fields have ONE source of truth — `csv/platforms/types.ts`.**
  Adding a metric the upload pipeline understands (e.g. `add_to_cart`,
  `add_payment`) means: (1) the schema column + migration, (2) `INTERNAL_FIELDS`
  + a `FIELD_META` entry (label + `required`) in `types.ts`, (3) each adapter's
  `headerMap` candidate, (4) `csv/pipeline.ts` parse + `ParsedRow`, (5) the
  commit route's `metricValues`. The mapping-admin UI (rows, add-header
  dropdown, platforms-readiness card) **derives** from `FIELD_LIST`/`FIELD_META`
  — do NOT re-list fields in those components. This was a real bug: those three
  UI components each kept their OWN hand-copied field list, so a new field
  landed in the pipeline but never showed in the CSV-mapping surface. Fixed
  by making them read `FIELD_LIST`; the `Record<InternalField, …>` types on
  `FIELD_META` and every adapter `headerMap` now make the compiler REJECT any
  field that isn't described everywhere (verified by injecting a probe field →
  5 adapter errors + 1 FIELD_META error). New optional metrics go in
  `FIELD_META` with `required: false` so existing uploads keep validating.
