# Store module

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- Store uploads are PARALLEL to the ads pipeline — **never touch `csv/`,
  `upload_batches` or `performance_records` for them**; own catalog
  (`store/errors.ts`, S-codes) and EXPLICIT header mapping, no auto-detect.
- **Currency is SAR, module-local (`sar()`). Never convert to USD here.**
- Exactly 3 CORE fields, 2 SYSTEM-REQUIRED (`utm_source`, `channel`, enforced
  server-side), everything else in `attributes` jsonb.
- **Upsert PATCHES `attributes`**: column present + value sets it, present +
  blank removes it, ABSENT leaves the stored value untouched.
- Sanctioned `store_orders` deletes: batch rollback + the order-cleanup tool.
  No other code deletes from it. The orders table is server-paginated.
- Insights is **store facts only, SAR only, no period comparison**; two scans
  per render; the analyze-by list DERIVES from `store_order_fields`; a blank
  value is its own visible bucket; the CSV exports the full breakdown.
- Reconciliation is **counts only — no revenue comparison anywhere**. Δ =
  claimed − store; Δ% divides by the STORE side; attribution is EXPLICIT
  mapping only on both axes; unmapped stays its own bucket.
- Every totals row on Reconciliation is computed from the range SUMS, never by
  averaging per-day figures.
- Insights' two lenses must bucket EXACTLY as Reconciliation does — the two
  pages may never tell different stories about the same day.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Store module

<!-- was CLAUDE.md L120–120 -->

- **Store module (2026-07) — a **Store** sidebar section split into `/store/uploads` (upload history + `/new` flow) and `/store/orders` (orders table); `/store` redirects to `/store/orders`. Manual Salla order uploads, PARALLEL to the ads pipeline (never touch `csv/`, `upload_batches`, `performance_records` for it).** Own error catalog `store/errors.ts` (S-codes; reuses `csv/parse.ts` for parsing only), EXPLICIT header mapping from `store_order_fields.headers` (case-insensitive trim, no auto-detect). Grain = one order (`store_orders`); exactly 3 CORE fields (`order_id`/`order_date`/`total_amount`) locked by `CORE_KEYS` in `store/fields.ts` — only label + headers editable, seeded per account (migration 0030 + `createAccount`). Custom fields → `attributes` jsonb. Upsert toggle like the ads upload; rollback deletes a batch's INSERTS only (updates keep their original `upload_batch_id`). **Currency is SAR, module-local (`sar()` in `lib/format.ts`) — NEVER convert to USD here** (ad-spend blending is a later phase). Config = the **Order fields** tab on `/store/uploads` (`config.store`); upload = `store.upload`. Migration 0030 (additive: `store_orders`/`store_order_fields`/`store_upload_batches` + core seed). Orders table is server-paginated (100/page) — never an unbounded query. **Every defined field is offered in the Orders Columns menu** (viewer's per-browser choice, persisted as a HIDDEN-key set so new fields default visible); the per-field `show_in_table` toggle was RETIRED 2026-08 (column kept dead, no longer read — like `creatives.status`; don't reintroduce reads). **Sanctioned `store_orders` delete paths = batch rollback + the order-cleanup tool** (`/store/uploads`, `store.cleanup`, in the editor preset): filtered hard-delete (date range / batch / order-id[s], ≥1 required), preview → type-DELETE-to-confirm → account-scoped transactional delete, audited `store.bulk_delete` (count from the actual DELETE, never an empty `inArray`) — mirrors the ads `upload.cleanup` tool. No other code deletes from `store_orders`.

### System-required store fields

<!-- was CLAUDE.md L1385–1398 -->

- **SYSTEM-REQUIRED store fields (2026-09) — a THIRD tier.** `utm_source` and
  `channel` (`SYSTEM_REQUIRED_KEYS` in `store/fields.ts`) exist in every account,
  can't be deleted, and can't have `required` switched off — enforced SERVER-side
  in `app/actions/store-field.ts`, not just hidden in the UI. They are NOT core:
  core stays exactly the three identity columns, and these two live in
  `attributes` jsonb like any other custom field. Label + accepted headers stay
  editable. **"Required" means the COLUMN must be present in every upload
  (S010) — blank CELLS are fine**: plenty of orders genuinely have no UTM, so the
  pipeline COUNTS blanks per field (`blankCounts`) and the upload review states
  it in neutral prose ("1,240 rows · 312 without a UTM source"), with no warning
  styling. An ordinary required custom field still errors on a blank (S042) —
  the two tiers differ on purpose. `createAccount` seeds all five rows (3 core +
  these 2); migration 0046 promotes an existing field KEEPING its label and
  headers, or seeds it where missing.

### Store → Insights

<!-- was CLAUDE.md L1399–1445 -->

- **Store → Insights (`/store/insights`, 2026-09) is STORE FACTS ONLY, SAR ONLY
  — a STANDING user decision.** No spend, no ROAS, no platform-claimed
  conversions, ever: Reconciliation owns claimed-vs-store and Budget owns the
  money plans, and a third surface mixing them is a second, disagreeing
  reconciliation. Every figure comes from `store_orders`. **NO period
  comparison in v1** (user decision) — the selected range only, so no tile
  carries a delta and nothing implies a trend the page didn't measure.
  Read-open to any brand member, like Orders.
  - **TWO SCANS per render, both bounded by the resolved range and both
    carrying the SAME filters** (`db/queries/store-insights.ts`): the per-day
    orders+revenue series (the KPIs are summed from it in JS, never re-queried)
    and ONE `GROUP BY` over the chosen dimension. `lib/db.ts` is `max: 1`, so
    an extra scan is a serial round-trip; never fetch per value. The range is
    resolved SERVER-side (`resolvePreferredRange` → last 30 days) like every
    other range-filtered page.
  - **The "Analyze by" list is DERIVED from `store_order_fields`** — never
    hand-listed, so a field added in Order fields appears with its configured
    label: system-required first, then the account's customs by `sort_order`,
    then the two mapped LENSES ("Platform (via UTM mapping)", "Channel
    (Website / Application)"). The three CORE fields are excluded on purpose
    (`order_id` is unique per row, `order_date` IS the trend, `total_amount` is
    the measure). Default = UTM source. The choice is URL-backed (`?by=`),
    validated against the derived list (a DELETED field's remembered value
    falls back, never scans a column nobody offers) and remembered per user per
    brand like a filter (0049; it is declared through FilterShell's
    `persistKeys` because it sits with the analyzer, not in the bar).
  - **LENS CONSISTENCY IS AN INVARIANT:** the two lenses bucket EXACTLY as
    Reconciliation does — the same unique mappings, the same
    `COALESCE(mapping, sentinel)`, the same Unattributed / Unmapped semantics
    (the sentinels now live in `store/sources.ts` + `store/channels.ts`, which
    `db/queries/reconciliation.ts` re-exports). Pinned in
    `tests/db/store-insights.test.ts` against `reconciliationByPlatform` /
    `reconciliationByChannel` output on shared fixtures: the two pages must
    never tell different stories about the same day.
  - **A BLANK value is its own visible bucket** ("No UTM source", named from
    the field's own label), never dropped and never merged — a blank cell and
    an absent column are the same answer. Values + blank sum to the range total
    BY CONSTRUCTION (one GROUP BY, no fan-out), which is test-pinned, and the
    `%`-of-orders share bar is a share of that total.
  - **Long tail:** past `TOP_VALUE_LIMIT` (40) values the tail folds into ONE
    "Other (N values)" row that KEEPS its orders and revenue, so the totals
    still reconcile; it sinks to the bottom whatever the sort (a null
    `sortValue`, the primitive's own rule) because it is a summary, not a
    value. **The CSV exports the FULL breakdown regardless** — the fold is a
    reading aid, an export is data. The query caps groups at
    `BREAKDOWN_GROUP_CAP`, since a free-text field can have as many values as
    there are orders.

### Store → Reconciliation

<!-- was CLAUDE.md L1446–1507 -->

- **Store → Reconciliation is COUNTS ONLY, by explicit user decision (2026-08).**
  `/store/reconciliation` compares store ORDER COUNTS vs platform-claimed
  CONVERSION counts per day. **Δ = claimed − store as of 2026-09-19 — the
  INFLATION framing, a user decision that SUPERSEDES the original
  `store − claimed`: POSITIVE Δ means platforms claim MORE than the store
  recorded** (actual 80, claimed 100 → Δ +20, Δ% +25%). Δ% divides by the STORE
  side (what actually happened is the base) and is still NULL when store = 0.
  The math lives ONLY in `reconDelta`/`reconDeltaPct` (`lib/reconciliation.ts`)
  and `channelDeltas` (`store/channels.ts`) — never re-derive a delta in a
  component, and do NOT "fix" the sign back. There is deliberately **no
  revenue comparison anywhere** on the page (no exchange rate, no revenue delta,
  no platform revenue): store revenue (SAR) and spend (USD) exist only as
  optional context columns, hidden by default, and are NEVER diffed against each
  other. Do **not** add a revenue/ROAS comparison without asking — it was
  explicitly scoped out. Δ% is warn-tinted by |MAGNITUDE| (over- and under-claim
  are both discrepancies — not good/bad green/red), and "—" when store = 0; the
  tone rule is sign-independent, so the 2026-09-19 flip left it untouched, as it
  left `reconMatchRate` (claimed ÷ store).
  **Attribution is EXPLICIT-mapping only** (house rule), on TWO axes since
  2026-09 (migration 0046) and nothing else is configurable:
  (1) **utm_source → platform** via `store_source_mappings`; the "which field is
  the source?" PICKER IS RETIRED — the source is always `utm_source`, pinned in
  code as `STORE_SOURCE_FIELD_KEY`, with `accounts.store_source_field_key`
  backfilled to it and NO LONGER READ (a kept-dead column, like
  `store_order_fields.show_in_table`).
  (2) **channel → Website | Application** via `store_channel_mappings` (unique
  `(account_id, raw_value)`; app-side enum, no DB enum). Unmapped/blank on either
  axis stays its own visible bucket — Unattributed for sources, Unmapped for
  channels — and is NEVER folded into a neighbour.
  **The page has TWO views (toggle FIRST in the controls row): Channels
  (DEFAULT) · Platforms.** The old **Overview** view was MERGED AWAY in 2026-09:
  it showed store orders vs claimed with revenue/spend for context, which is a
  strict SUBSET of Channels (Store total · Claimed + the two context columns), so
  its table, columns-menu branch and CSV variant were deleted rather than
  maintained. Mode is client state defaulting to `"channel"` and has never been a
  URL param, so no saved link can ask for the removed view. Channels is a
  **DataTable** (flat columns → the canonical home; sortable throughout, day
  desc by default, evenly-sized columns, pinned totals row): Store total ·
  Website · Application · Unmapped (column only when > 0) · Claimed (all
  platforms) · **Δ incl. app** = claimed − (Website + Application) · **Δ incl.
  app %** · **Δ excl. app** = claimed − Website · **Δ excl. app %** — the number
  and its share are SEPARATE sortable columns, each Δ% warn-tinted by
  |magnitude| and sorted by SIGNED value with "—" (store 0) last in both
  directions. Revenue (SAR) and Spend (USD) are the hidden-by-default context
  columns that came over from Overview; the CSV exports exactly the visible
  columns in the on-screen sort. Rationale, stated on the page: platform pixels
  largely see WEBSITE purchases, so Δ excl. app is the honest attribution gap and
  Application explains the rest. Platforms leads with Day · Store total ·
  Unattributed · Unattributed % (= unattributed ÷ store total,
  `unattributedShare`, NULL → "—" when the store total is 0) and then one
  four-column group per platform. **Every totals row on this page is computed
  from the range SUMS (`sumChannelDays`, `sumPlatformDays`), never by averaging
  the per-day figures** — test-pinned, because a mean of daily ratios is a
  different and wrong number. **Invariant (test-pinned): Website + Application +
  Unmapped = Store total every day** — buckets reconcile by construction via the
  unique mapping, exactly like platforms. Never
  auto-match source values. Buckets reconcile by construction (unique mapping →
  no fan-out → per-platform + unattributed = overview count). Pure Δ/Δ%/lag math
  lives in `lib/reconciliation.ts`; queries in `db/queries/reconciliation.ts`
  reuse `sumConversions`/`sumSpend` from `lib/metrics` and the per-platform
  freshness scan for the "still attributing" lag hint. Migration 0031 (additive).


### Store upsert PATCHES attributes

<!-- was CLAUDE.md L1955–1965 -->

- **Store upsert PATCHES `attributes`; it does not replace them (2026-09).** A
  store export is often a partial view of the order, so the pipeline reports
  which configured custom fields actually had a mapped COLUMN in the file and
  `writeStoreBatch` uses that: column PRESENT + value → set the key; column
  PRESENT + blank → REMOVE the key (explicit clears still work); column ABSENT →
  leave the stored value untouched. Never go back to writing the whole object on
  an update — that wiped every custom value whose column wasn't in that file.
  Note the drizzle trap: an array inside a raw `sql` template expands to
  `($1,$2)` (a row expression), so the cleared-keys list is bound as ONE
  `text[]` literal.
