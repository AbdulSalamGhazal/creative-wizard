# The upload pipeline (CSV/XLSX)

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- **A row number is the row's place in the FILE** (W1-13, 2026-10-23):
  `csv/parse.ts` numbers every line or sheet row first and drops blank ones
  after, so an error below a blank line cites the right row. XLSX date cells
  are read as Excel stores them — a serial in a date-format cell — and
  converted with `SSF.parse_date_code`, never through a JS Date, so the day
  is the same in any server timezone (a UTC+3 process read them a day
  early); the 1904 flag is honoured.
- The upload routes answer **401 signed out, 403 signed in without the
  permission** (`lib/route-auth.ts`). A rollback CLAIMS its batch inside the
  transaction (`… WHERE status = 'active' RETURNING`), so two concurrent
  rollbacks can't both succeed.
- The pipeline is 5 stages, in order; stages 1–2 fail fast, 3–5 collect; and
  **all-or-nothing** — nothing is written unless the whole file is clean.
- Matching is **trim-then-exact** (case-sensitive, no NFC); blank/`-`/`N/A`
  numeric cells read as **0**; E042 is for blank IDENTITY fields only, and a
  missing required column is E010. This is a decision, not a bug.
- **CSV or XLSX through ONE conversion layer** — nothing downstream may branch
  on the format. SheetJS is the reader; never add a second one.
- **ONE upload limit: 4 MB, on every surface (D5, 2026-10-23)** —
  `MAX_FILE_BYTES` / `FILE_TOO_LARGE_MESSAGE` in `csv/limits.ts` (dependency-
  free, re-exported by `csv/parse.ts`; the browser reads it without pulling
  SheetJS into three pages — W2-6), shown up front by the shared Dropzone. It is what the host accepts: Vercel refuses a
  function body over 4.5 MB, and the server-action surfaces get 4.5 MB
  through `serverActions.bodySizeLimit` (Next's default is 1 MB — files over
  it failed while every screen promised 10 MB, and the Store panel hung).
  Raise it only by uploading to file storage first, never by editing the
  number.
- **An ad name may end in ` @code`** — one space, `@`, the code of a landing
  page registered on the Library's Landing pages tab. `lib/landing-code.ts`
  splits the trimmed cell at the FIRST ` @`; the creative matches on the part
  before it (trim-then-exact, unchanged), the code matches the registry
  exactly and case-sensitively. Malformed → E022, unregistered → E023. No
  marker = the product's own page (`landing_page_id` NULL).
- **The landing page is part of the record identity** (`perf_identity_uq`,
  NULLS NOT DISTINCT): E050, E051 and the upsert partition all key on it, so
  one creative may run to two pages in one ad set on one day.
- **A landing code can't change on a live ad (E052, both modes).** Platforms
  export a live ad's CURRENT name for every past day; a day already stored
  under a different landing page that the file does not also carry is a
  rename, and importing it would count the day twice. "Carries" counts every
  row whose identity resolves, even one failing another check. The way out
  the message gives is the one an uploader can take: upload only the days
  after the rename.
- **Stage 5 is ONE query per file** (`findExisting(days, platform)`, IN-lists
  per column, keyed in the pipeline). Upsert reuses those rows for its
  partition — never a per-day lookup (≈9,000 sequential queries for 300 ads
  × 30 days).
- COUNT metrics round to the nearest whole number at NORMALIZATION and say so
  (W004); which fields are counts is declared once in `FIELD_META.kind`.
- Adding an internal field means all five places; the mapping UI DERIVES from
  `FIELD_LIST`/`FIELD_META` — never re-list fields in a component.
- Upsert reuses the import validation (so the file must carry all mapped
  columns) and its UPDATES are not rollback-able.
- **All-or-nothing holds in upsert too (W1-8, 2026-10-23):** the commit
  updates EVERY record matched at validate time or rolls back — a matched
  record removed in between (rollback, cleanup) is a 409 "Some records
  changed since validation. Validate the file again.", never a 200 that
  silently dropped the row.
- `performance_records` has exactly four sanctioned exit paths; no other code
  deletes from it.
- **A cleanup deletes EXACTLY what was previewed, or nothing (W1-7,
  2026-10-23).** The client sends the filters it PREVIEWED (a response for
  older filters is dropped) with the count it showed (`expectedRows`,
  required); the server refuses when its own count differs and deletes
  inside a transaction that rolls back unless it removed that many rows
  (`lib/cleanup-guard.ts`). After a delete the range resets to the picker's
  default, never null ("Last 7 days" on the pill, all time on the server).
  The store order-cleanup tool follows the same rule.

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

### Landing-page codes in ad names (2026-10)

- **The ask:** some ads send traffic to a landing page instead of the product's
  own page; the team marks them by ending the ad name with ` @code`. The
  upload must accept those names, attach the row to the registered creative,
  and keep the code. Decided with the user before building (reviewer pass):
  the code joins the record identity (an A/B test runs `Promo_01` and
  `Promo_01 @lp2` in one ad set on one day — without it, E050 rejected the
  whole file); a code changing on a live ad is refused (E052); the parse is
  strict (one space, `@`, letters/digits/`-`/`_`; anything else E022, case
  matters); creative names may not contain ` @`; all platforms; and — added
  by the user — a **landing-page registry** (name, code, link, optional short
  description) on the Library's Landing pages tab beside Products, with
  uploads rejecting an unregistered code (E023, wording approved).
- **Why E052 needs the "file does not also carry it" clause:** checking only
  "stored under a different page" would refuse a legitimate upsert re-upload of
  an A/B day (both pages stored, both in the file). The rename signature is a
  stored page the file has NO row for that day.
- **Schema:** migration 0054 — `landing_pages` table, nullable
  `performance_records.landing_page_id` (no cascade), and the old unique index
  replaced by the `perf_identity_uq` constraint. A constraint, not an index,
  because only drizzle's `unique()` builder can say NULLS NOT DISTINCT
  (Postgres 15+). Once a record uses a landing page its code is locked and it
  can't be deleted (`app/actions/landing-page.ts`).
- **Visibility:** the upload summary card lists the codes in the file with
  their row counts (main-page rows aren't listed), and the creative's records
  table offers a `defaultHidden` "Landing page" column. **Trends → LPs
  (`/trends/landing-pages`, 2026-10-25)** is the breakdown: one row per
  landing page over the resolved range, with the NULL bucket as its own row
  named **"Product page"** (the user's wording — an ad with no ` @code` goes
  to the product's own page; `PRODUCT_PAGE_LABEL` in `lib/landing-code.ts` is
  the one spelling). Decided with the user before building: the eight metrics
  visible (spend · impressions · clicks · CTR · conversions · CPA · revenue ·
  ROAS, the rest of the query's fields `defaultHidden`); TWO row modes, by
  page and by page × platform (a client view switch, both rollups sent with
  the page); google EXCLUDED like the other Trends children
  (`PLATFORMS_WITH_CREATIVES`); the range is URL → the user's saved range →
  the last 30 days; the table first, the chart under it — one line per page,
  per day: Spend, Conversions, ROAS, CTR, CvR, CPA, CPC (the ratios added at
  the user's ask after the first render; the daily query carries the
  component sums and the chart derives each DAY's ratio from that day's sums,
  a gap where the denominator is 0, never a zero); platform AND product filters through the
  standard `FilterStrip`. Queries in `db/queries/landing-page-performance.ts`
  (every ratio a `lib/metrics` fragment; `tests/db/landing-page-performance
  .test.ts` pins the per-page sums, the NULL bucket, Excluded, the google
  drop and brand scoping). Still no landing-page FILTER anywhere.
- **Every landing page sells ONE product (2026-10-29, user: "a big bug" —
  the first LPs page summed every product's no-code ads into one Product
  page row, which compared nothing with anything).** `landing_pages
  .product_id` (migration 0064), required by the registry on every save
  (the dialog's Product picker; the action re-validates the id against the
  brand) and locked with the code once records use the page. Decided with
  the user, each with the recommendation taken: (1) an upload whose creative
  belongs to another product than its `@code`'s page is REFUSED — **E024**,
  checked in Stage 3 beside E023 from two maps the validate route passes
  (`creativeProducts`, `landingPageProducts`), skipped for a page with no
  product yet; (2) pages registered before the rule are BACKFILLED
  (migration 0065, data-only: the product their records point to when that
  is one product), the rest stay NULL and read "Needs a product" in the
  registry (the next edit must pick one — a page with none may be given one
  even while in use) and group under "No product" on LPs; (3) Trends → LPs
  GROUPS by product — one `DataTable` row per product, open by default on
  its own page (first, the baseline) and its landing pages, the wrapper
  owning the sort like the Funnel platform table; a landing-page record
  counts under its PAGE's product, a no-code record under its creative's;
  the chart's lines are "Product · Page", coloured per product with the own
  page dashed; (4) a product with NO registered landing page is left off
  the page entirely — nothing to compare — and the Products filter is the
  product a row counts under, so a filtered group arrives whole.

### Landing pages — the independent review's fixes (2026-10-20)

- The feature was clarified, built, migrated and shipped from ONE session;
  the user then had a fresh session review commit c4cb61e read-only. No
  data, tenancy or permission bug; the fixes it prompted:
  - **Stage 5 went from one query per (creative, campaign, day) to one per
    file**, and upsert stopped re-querying the same rows for its partition.
  - **Spurious E052:** the "file carries this page" set was built from
    ACCEPTED rows only, so a main-page row failing E040 made its valid
    `@code` sibling look like a rename. It is now built from every row whose
    identity resolves.
  - **E052's way out was unreachable** — "rename the ad back, or roll back
    that batch" (rollback is 24 h and not in the editor preset). It now says
    to upload only the days after the rename (user decision).
  - **E023 sent uploaders to a tab they couldn't see** (`catalog.landing_pages`
    isn't in the editor preset). The tab is now READ-ONLY for anyone with
    `upload.import` (user decision); writes stay gated.
  - **Code-lock race:** the code lock and delete guard checked, then wrote,
    outside a transaction. Both now run under `SELECT … FOR UPDATE` on the
    landing page, and the upload commit re-reads its landing pages `FOR KEY
    SHARE` inside its transaction and refuses (422) if a code changed — the
    two locks conflict, so they can't interleave.

