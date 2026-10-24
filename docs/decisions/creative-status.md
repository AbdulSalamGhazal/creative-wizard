# Creative & campaign status

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- **Status is DYNAMIC (spend-derived), never a stored field.**
  `creatives.status` is a dead column; don't reintroduce reads (its index,
  `creatives_status_idx`, was dropped in migration 0061).
- Per-platform status anchors to **each platform's OWN latest spend day**,
  never a global "today". General status is a roll-up.
- Campaign status is the same rule, 2-state, with NO override and NO schema.
- **Status maps derive from the request's cached `brandStatusInputs()` — never
  add another status scan**, and don't narrow a shared scan with a big `IN`.
  The `asOf` point-in-time variant is the one sanctioned exception — for its
  ACTIVITY and FRESHNESS scans only: terminations come from the one cached
  `brandOverrides()` read (with each row's `terminated_at::date`), filtered
  by day in JS (W2-3, 2026-10; the Dashboard read the table three times).
- Terminated is manual, sticky, and per creative×platform.
- The Library's status STRIP is a FACET of the listing: counted after every
  other filter and BEFORE the status filter, so selecting one chip can never
  zero the others.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Creative status is dynamic

<!-- was CLAUDE.md L762–791 -->

- **Creative status is DYNAMIC (spend-derived), not a stored field.** The old
  manual `creatives.status` enum (draft/active/paused/archived) is retired —
  the column still exists but is **no longer read** (kept to keep migration 0015
  additive; a later cleanup can drop it). Status now = `New` (never spent
  anywhere) / `Active` (spent within the brand's window of a platform's OWN
  latest data day) / `Pause` (ran but not within the window) / `Terminated`
  (manual, sticky, **per creative×platform**, stored in `creative_platform_overrides`).
  Pure derivation lives in `lib/creative-status.ts` (`deriveCreativeStatus`,
  `STATUS_LABEL`/`STATUS_DOT`); the account-scoped query is
  `db/queries/creative-status.ts` (`creativeStatusMap(ids?)` + `statusFor`).
  **Per-platform status is anchored to each platform's own latest SPEND day**
  (the latest day with `spend > 0`; the freshness query matches the activity
  query's `spend > 0` so a trailing $0 day can't mislabel a recent spender as
  Pause — uploads are per-platform, so freshness differs per channel) — never a
  single global "today"/max-date. General status is a roll-up: `active` if active on any
  platform ▸ else `pause` ▸ else `terminated` (terminated everywhere it ran) ▸
  else `new`. The window is per-brand `accounts.status_window_hours` (default 24;
  daily-grain data rounds up to whole days, so 24h = the latest day only),
  editable in the Brands admin via `setStatusWindow`. Terminate/reactivate =
  `setCreativeTermination` (per creative×platform). Render with
  `<StatusBadge>`. The aggregate KPI views (Overview/Trends/Funnel/Compare)
  dropped their status filter (can't be a SQL WHERE); Library + Summary keep it
  (Summary's is platform-scoped). Summary's status column SORT is a JS re-sort
  over the DERIVED `generalStatus` (STATUS_ORDER), and the status column defaults
  to **asc on first click** (active→pause→new→terminated, so the most-relevant
  show first) via `firstDir()` in summary-table.tsx — NOT the dead legacy column.
  The Library "status" sort likewise re-sorts in JS by the derived status
  (STATUS_ORDER in db/queries/creatives.ts). Migration
  0015 (additive: the overrides table + window column + archived→terminated
  backfill) is applied to prod.

### Campaign status is dynamic

<!-- was CLAUDE.md L792–811 -->

- **Campaign status is DYNAMIC too — 2-state (Active/Inactive), purely derived,
  NO override, NO schema.** Parallels creative status but simpler: a campaign is
  `active` if its last real-spend day (`spend > 0`, non-excluded) is within the
  brand's window of its platform's OWN latest spend day, else `inactive`
  (includes never-spent). Same window (`accounts.status_window_hours` →
  `hoursToWindowDays`) and same per-platform freshness anchor as creative status,
  and likewise computed over ALL data (current liveness), NOT the selected date
  range. Derivation: `lib/campaign-status.ts` (`deriveCampaignStatus`,
  `CAMPAIGN_STATUS_LABEL`/`_DOT`/`_ORDER`, reuses the now-exported `isoMinusDays`
  from `lib/creative-status.ts`); account-scoped query
  `db/queries/campaign-status.ts` (`campaignStatusMap(ids?)` — two scans:
  per-`(campaignId, platform)` last-spend-day + per-platform freshness — rolls up
  active-if-any-platform for the rare untagged multi-platform campaign; +
  `campaignStatusFor` defaulting to `inactive`). Rendered by
  `<CampaignStatusBadge>` on the **campaigns table** (a sortable/CSV Status column
  between Objective and Platform) and the **campaign detail** header. Because it's
  derived it CAN'T be a SQL WHERE — the `statuses` filter (URL-backed dropdown in
  `portfolio-filter-bar.tsx`, validated via `csvEnum(CAMPAIGN_STATUSES)`) is
  applied in the query layer (`portfolioCampaigns` filters the rows after
  attaching status), same as Library/Summary creative-status filters.

### The Library's status strip is a facet

<!-- was CLAUDE.md L2222–2233 -->

- **The Library's status STRIP is a FACET of the listing, not a query
  (2026-09).** It sits directly ABOVE the list (both views), not in the page
  header, because it describes what you are looking at and must move when the
  filters move. Its counts come back on `listCreatives().breakdown`, computed
  in JS from the rows that call already matched — **after every other filter,
  BEFORE the status filter narrows them**. That ordering IS the behaviour:
  selecting "Active" must not zero the other chips, or there would be no way
  back. Consequences: it costs NO query (the old `creativeStatusBreakdown()`
  and its per-platform half are gone — the strip's platform row went with them,
  a user decision), and it can never disagree with the table below it. The pure
  counter is `statusBreakdownOf` in lib/creative-status.ts.


### Status maps come from one cached read

<!-- was CLAUDE.md L2234–2249 -->

- **Status maps derive from the request's cached `brandStatusInputs()` — never
  add another status scan (2026-09 perf pass).** Status is computed on nearly
  every page and each consumer used to run its own three scans of
  `performance_records`. `brandStatusInputs()` (React `cache()`, per request, in
  `db/queries/creative-status.ts`) now fetches per-creative activity,
  per-platform freshness and overrides ONCE, unrestricted; every status map is
  derived from it in JS. Campaign status keeps its own activity scan (it groups
  by campaign, not creative) but shares `platformSpendFreshness()`. The `asOf`
  point-in-time variant is the ONE sanctioned exception — it reconstructs a past
  day and can't read today's numbers. Corollary: **don't narrow a shared scan
  with a big `IN (…)`** — pass no ids and filter the map in JS. Remember
  `lib/db.ts` is `max: 1`, so `Promise.all` is serial: fewer queries is the only
  lever, not more concurrency. `tests/db/status-cache.test.ts` pins this by
  counting round-trips.

### The Dashboard's status flow reads the overrides once (2026-10, W2-3)

- `statusFlowBreakdown` reconstructs two past days (`asOf` = the day before the
  range and its last day) and each reconstruction read
  `creative_platform_overrides` with `terminated_at::date <= asOf` — on top of
  the unbounded read inside `brandStatusInputs()`. The table is tiny and the
  date test is a pure comparison, so `brandOverrides()` (React `cache()`)
  selects every termination once with its day computed BY THE DATABASE
  (`terminated_at::date::text`, the same cast the old WHERE used, so the
  boundary can't move with a time zone) and both paths filter it. The
  activity and freshness scans of the reconstruction stay date-bounded — they
  are the reconstruction. Pinned by `tests/db/dashboard-queries.test.ts` (a
  termination counts from its own day, not the day before).
