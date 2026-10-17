# Budget

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- Actual spend applies **NO exclusion filtering** anywhere in Budget — raw
  `performance_records` totals. Budget figures may therefore differ from the
  dashboards; never "fix" this.
- Revenue is store FACTS, as a monthly total only. **Revenue has no platform
  attribution anywhere in Budget** — a platform filter locks the metric to
  Spend and the UI says why.
- The USD↔SAR toggle is display-only, but **ROAS is always computed through
  `accounts.usd_to_sar_rate`** (default 3.77).
- **Every plan-to-date number goes through `buildPlanSeries`.** Never expand a
  curve or read day cells in a page again.
- A month is planned by the CURVE system **or** by day cells — one mode at a
  time, pinned by `savePlanSchema.source` and refused server-side otherwise.
- **`replaceBudgetMonth` is the ONE plan writer** (save, upload, copy, restore,
  convert). In daily mode allocations are DERIVED sums, never client-supplied.
- Every write that changes a plan appends a revision snapshot **inside the same
  transaction**; a restore re-validates through `planSchema` first.
- **Pacing compares against DATA COVERAGE, never the calendar**
  (`platformHorizons` → `makeCoverageDay`). A total is the SUM of its rows'
  expectations, not a second calculation over the whole plan.
- The reserve is part of the total, carved out of it, and sits OUTSIDE the
  curve. Save is blocked below 100% — uncommitted money belongs in the reserve.
- **Reserve USED = Σ over platforms of max(0, actual − planned)**, where
  `planned` is the platform's whole allocation across its buckets (0 for a
  platform with no plan). Spend beyond the plan at PLATFORM level draws the
  reserve; money that lands in a different objective bucket of a planned
  platform is objective DRIFT — shown as an unplanned row — never a reserve
  draw. One helper, `reserveUsed`, and every "reserve used" on every surface
  reads it (2026-10-17, user decision).
- **The Overview is three hero cards, one chart and the pace board** — every
  number on it is `buildTrackerRows` (the Tracker's rows) or the plan series;
  it never carries a second math path. ROAS has equal billing with spend and
  revenue.
- **The allocation check lives on the Tracker's table view (`group=objective`)**
  — the same `buildTrackerRows` output regrouped, never a second derivation.
- Budget's objective axis is `BUDGET_OBJECTIVES` (buckets), applied at every
  layer and never re-listed.
- Audience snapshots: carry forward as a STEP, never interpolate; before the
  first measurement the size is UNKNOWN, never 0; pressure counts only days
  with a known audience.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Sparse audience snapshots

<!-- was CLAUDE.md L426–442 -->

- **Sparse audience snapshots: carry forward, never interpolate (2026-09).**
  `audience_snapshots` holds only the days somebody actually MEASURED an
  audience, so every reader in `lib/audience.ts` follows four rules that are
  deliberate, not gaps to be filled: (1) between measurements the last known
  size carries forward as a STEP — a ramp would invent numbers nobody took;
  (2) before a pair's first snapshot the size is UNKNOWN (`—`), never 0 — an
  unmeasured audience is not an empty one; (3) every displayed size carries its
  age, with ONE neutral threshold (`STALE_AFTER_DAYS = 7`) that says "old", not
  "bad" — v1 passes no judgment on size, and stores no target bands; (4)
  pressure (spend per 1,000 audience) counts ONLY days with a known audience and
  is computed as component sums (Σspend ÷ Σ(size/1000)), so an unknown day can
  never smuggle its spend into the ratio and a zero audience gives `null`, not
  Infinity. A range's early days are only knowable because
  `audienceSnapshotSeries` fetches the latest snapshot BEFORE the range as a
  seed — drop that query and the page silently reads "unknown" for a pair
  measured last month.


### The Budget module

<!-- was CLAUDE.md L1545–1890 -->

- **Budget module (2026-09, v2) — raw actuals BY DECISION.** Its own sidebar
  section of 5 pages (`/budget` Overview · `/budget/plan` · `/budget/tracker` ·
  `/budget/pacing` · `/budget/audience`);
  Overview and Plan share `?month=` (nav links preserve it), Pacing takes a date
  range. The old **Daily** and **History** pages MERGED into Pacing and are
  permanent redirects to it (History asks for the last 12 months grouped by
  month) — don't reintroduce them. Monthly spend
  plan (USD, platform → objective) vs actual and ONE monthly revenue target
  (SAR) vs store actuals, paced along a **plan curve** (the day-weight curve;
  user-facing text says "plan curve" — only non-1 day
  weights stored in `budget_day_weights`; no-overrides ≡ v1 linear, unit-pinned;
  ONE curve for spend AND revenue; projection = actual ÷ elapsed curve
  fraction) plus a **reserve** (`budget_targets.reserve_spend_usd`, part of the
  total and carved out of it, deliberately OUTSIDE the curve; "used" = Σ
  platforms max(0, actual − plan), the platform-level rule — see the 2026-10-17
  entry; it was the sum of unplanned combos until then).
  Standing decisions: actual spend deliberately applies **NO exclusion
  filtering** anywhere in Budget (raw `performance_records` totals, per-day
  included — budget totals may differ from dashboards; never "fix" this);
  revenue = store FACTS as a monthly total only (no breakdown; claimed-vs-real
  lives on Reconciliation); the USD↔SAR toggle is display-only (localStorage)
  but ROAS is ALWAYS computed through the per-brand `accounts.usd_to_sar_rate`
  (default 3.77). The Tracker table's unplanned rows must reconcile the actual
  total to the raw month total exactly (harness-pinned on the query). A period
  past its side's horizon renders as an em-dash (unknown ≠ 0). Pacing VERDICTS
  (Overview's hero cards and its pace board) are current-month-only; the
  **Pacing page** is a date range. Deviations everywhere are warn-tinted by |magnitude| — never
  green/red. Permission
  `budget.manage`; audit `budget.update`. Migrations 0035 + 0036 (additive).
  **Plan modes (curve | daily, 0048) — see PLAN MODES below; every
  plan-to-date number goes through the unified plan series.**
  - **The Plan tab is planning-only (2026-09).** `/budget/plan` carries intent
    and nothing else — Platform/objective · Planned · % share. The Actual,
    Pacing, Variance and Variance % columns and the "unplanned" ghost rows were
    REMOVED; plan-vs-actual lives on Overview and the Pacing page.
    `getBudgetMonth()` still returns `actualSpendByCombo` for its other
    callers — don't reshape it; the Plan page just ignores it.
  - **The Plan editor is a TOP-DOWN CASCADE (2026-09): targets → platform
    shares → objective shares → day curve.** Percentages are the PRIMARY input;
    amounts are derived cents-exactly from them (amounts stay editable and
    back-compute their share against a held parent). `budget_allocations
    .planned_spend` (USD) is still the only storage — SAVE stores the derived
    amounts, EDIT reconstructs the shares from them (total = Σ allocations +
    reserve) at full precision, so a round-trip is exact. Pure helpers in
    `lib/budget.ts`: `allocatableFromTotal`, `reserveShare`/`reserveFromShare`,
    `amountsFromShares`, `shareFromAmount`, `sharesComplete`,
    `distributeShareEvenly`, `normalizeShares`, `moveMoney` — plus the cents-exact
    `splitByWeights`/`distributeRemainder` they build on. Never re-derive this
    math per component.
  - **The RESERVE is part of the TOTAL, not on top of it (2026-09 framing).**
    `allocatable = total − reserve`; the reserve is money carved out and not yet
    allocated. Storage (`budget_targets.reserve_spend_usd`) is UNCHANGED, and it
    still sits OUTSIDE the plan curve — the curve paces the ALLOCATED plan
    only. "Used" is the platform-level rule (`reserveUsed`, 2026-10-17): spend
    beyond a platform's whole plan draws the reserve down; a planned platform
    spending in a different bucket is drift, not a draw.
  - **Save is BLOCKED below 100% (user decision).** Platform shares must reach
    exactly 100% of the allocatable and every planned platform's objective
    shares must reach exactly 100%; the banner names each gap and "Distribute
    remaining evenly" fixes it in one click. Money not yet committed belongs in
    the RESERVE, never in a gap. Rounding must never block — `SHARE_EPSILON`
    tolerates float dust only, and derived amounts are cents-exact.
  - **Two mid-month operations, KEEP THEM DISTINCT.** Changing the total (or
    reserve) RESCALES everything through the current shares. "Move money"
    moves money: the source (the reserve or a platform) falls by the amount —
    or, for new money, the total grows by it — one platform's dollars rise by
    it, and every other platform's dollars are untouched (only their displayed shares move). Don't
    collapse them into one control — the difference is the whole point.
  - **Plan revisions (`budget_plan_revisions`, migration 0040, additive).**
    Every write that changes a plan — `saveBudgetMonth` (editor, sheet upload
    AND delete), `copyBudgetFromMonth`, `restorePlanRevision`,
    `convertPlanToCurve` — appends a jsonb snapshot of the plan AS IT STANDS
    AFTERWARDS, **inside the same transaction as the write**. Any new plan-write
    path must do the same, or the history silently gains a hole. A restore
    re-validates its snapshot through `planSchema` FIRST (a snapshot predating a
    vocabulary change fails loudly rather than half-applying) and is itself
    recorded as a revision, so restoring never loses the state it replaced.
    `copyBudgetFromLastMonth` was renamed `copyBudgetFromMonth({month, from})` —
    copy from ANY planned month, options from `plannedMonths()`.
  - **Budget has its OWN objective axis (2026-09) — `BUDGET_OBJECTIVES` in
    lib/budget.ts: Awareness · Activation · Retargeting · Other.**
    `toBudgetObjective(campaignObjective)` keeps the three mains and sweeps
    everything else (Sales, Prospecting, Special Case, anything added later)
    into **Other**. Campaign objectives OUTSIDE Budget are untouched. The bucket
    is applied at EVERY budget layer — `planSchema`, the Plan editor's pickers,
    actual-spend grouping (folded inside `db/queries/budget.ts`, so no consumer
    can forget), and revision restore, which folds legacy snapshots through
    `mergeAllocationsToBuckets` and SUMS rows that collapse together (an old
    Sales + Prospecting snapshot restores as one Other row instead of failing
    or colliding on the unique index). Migration **0041** (hand-written, DATA
    only) did the same fold to the stored rows — it stages the totals in a temp
    table, deletes, then re-inserts, because a data-modifying CTE doesn't order
    its DELETE against the outer INSERT and the unique index would abort.
    **Never re-list the buckets** — derive from `BUDGET_OBJECTIVES`.
  - **The allocation check lives on the Tracker's table view, `group=objective`
    (2026-10; it was a table of its own on Overview from 2026-09).** Objective
    subtotal → its platforms, an "unplanned" badge on a combo with no plan
    row, the table's own columns (Plan · Actual · Expected · Δ · Δ% ·
    Projection) — all `buildTrackerRows` output regrouped by
    `groupTrackerByObjective`, no second math path, no re-derived
    expectations; totals pinned, CSV for both groupings. The
    reconcile-to-raw-month-total invariant is the QUERY's and stays pinned by
    tests/db/budget.test.ts; the regroup is pinned to move money without losing
    it in lib/budget.test.ts. `components/budget/budget-allocation-check.tsx`
    and `TABLE_KEYS.BUDGET_ALLOCATION` were deleted (no stored prefs carried
    the key).
  - **Pacing is a DATE RANGE, not a month (2026-09).** URL-backed
    `from`/`to`/`groupBy`/`platforms`; group by Day / Week / Month (weeks are
    Sunday-start calendar weeks CLIPPED to the range); a platform multi-select
    that scopes BOTH actual and plan; metric Spend / Revenue / **ROAS**
    (on-plan ROAS = target-to-date ÷ (plan-to-date × rate)); an objective
    toggle that gives one series and one table block per bucket. **Revenue has
    no platform attribution anywhere in Budget** (that's Reconciliation), so a
    platform filter LOCKS the metric to Spend and the UI says why instead of
    hiding it. Plans are per MONTH, so a range takes each month's plan SERIES
    (curve-spread or daily cells) and stitches them (`stitchPlanByDay`);
    `budgetPlansForMonths(months)` is FOUR queries (one per plan table, incl.
    `budget_plan_days` since 0048) with an `inArray`, never one
    per month, and `budgetPacingSeries(from, to)` stays two scans (`max: 1`).
    The objective on a spend row is the campaign's CURRENT objective seen
    through the bucket lens, so reclassifying a campaign restates budget
    history. `budgetHistory()` was deleted — month grouping replaced it.
  - **PACING COMPARES AGAINST DATA COVERAGE, NEVER THE CALENDAR (2026-10,
    standing decision — a user-reported bug).** "Planned so far" means
    "planned through the days THIS PLATFORM's data covers". Actuals end at the
    last upload; the calendar does not; comparing the two made every platform
    read ~a day behind every morning, and worse the longer an upload lagged.
    - The coverage read is `platformHorizons()` — MAX(date) per platform,
      account-scoped, **not** the status system's `spend > 0` freshness (that
      answers "is it still running"; a $0 day still COVERS). It REPLACES the
      pages' `dataHorizon()` call rather than adding one — the overall "data
      through" is just the latest of them (`latestCoverage`).
    - `makeCoverageDay` is the one rule (`coverageDayInMonth`): no data, or
      data that stops before the month → **0, so the row expects nothing and
      has no verdict — never "100% behind"**; a PAST month → the full month, so
      history is bit-identical to before (regression-pinned); a future month →
      0. Every pacing surface shares it: Tracker (both views), Overview's hero
      cards, chart and pace board.
    - **A total is the SUM of its rows' expectations**, not a second
      calculation over the whole plan — with coverage diverging those differ,
      and the one the cards add to is the honest one. The projection divides by
      the COVERAGE fraction (Σ expectations ÷ plan), so a lagging upload stops
      forecasting a shortfall that isn't there. Revenue paces against the STORE
      horizon (`REVENUE_COVERAGE_KEY`) — separate pipeline, separate coverage.
    - **"Planned for today" on Overview stayed CALENDAR-based** while it
      existed — "what does the plan put on today" is a different question and
      has an answer before today's data exists. The 2026-10 Overview rebuild
      removed that line; `elapsedDaysInMonth` keeps its calendar display uses
      ("Day 21 of 30", the chart's Today marker) and nothing else.
    - The header says what it counted through, and names any platform trailing
      the rest by more than a day ("TikTok data ends 2026-09-13"); every bar's
      aria-label speaks its OWN anchor.
  - **Tracker (`/budget/tracker`, 2026-09) — the daily pace board.** One
    question, answered in bars: who's ahead, who's behind, by how much.
    **THE BARE PAGE IS THE PRODUCT — zero configuration is its identity**, so
    the 2026-10 controls (platform · bucket · off-pace-only · the view · the
    row order) are OPT-IN and REMEMBERED (0049) rather than decisions anyone
    has to make to read it. **Pacing is still the analysis tool** (ranges,
    grouping) and **Overview is still the month's verdict**. Nothing here is
    new data: it reads the SAME `getBudgetMonth()` payload and derives
    everything through `buildTrackerRows` (pure, unit-tested, in lib/budget.ts),
    which composes the module's existing conventions — the plan SERIES for
    plan-to-date (curve or daily), `pacingDeviation` / `pacingTone` for the
    magnitude-based verdict, the coverage-anchored projection for the "on this
    pace" line. **Never re-derive pacing in the page.**
    - **TWO VIEWS, ONE SET OF ROWS (`?board=bars|table`).** BARS is the default
      and unchanged. TABLE is a DataTable of the same `buildTrackerRows`
      output — platform subtotal + bucket rows, Plan · Actual · Expected · Δ ·
      Δ% · Projection, sorted by Δ% desc, totals pinned, CSV — for when you
      want to rank and export rather than scan. **No second math path.**
      Since 2026-10 the table has a GROUPING (`?group=platform|objective`,
      `TRACKER_GROUPS`, visible only while the table board is active):
      `platform` is the table above; `objective` is the allocation check —
      objective subtotal → its platforms, unplanned combos badged — from
      `groupTrackerByObjective`, with the totals row summing whichever
      subtotals are shown so both groupings foot to the same month. The
      objective grouping OPENS on the identity column in funnel order — a
      Δ% ranking would sink an unplanned row (it has no Δ%) out of its
      objective and under another's heading — while the platform grouping
      keeps Δ% desc; the bucket filter governs unplanned rows too, and
      "Off-pace only" drops them (no verdict is not off-pace).
    - **Opt-in controls, each remembered:** tier-1 `platforms` (the shared
      key), tier-2 `buckets` and `offpace` ("Off-pace only" — it hides rows
      within the warn threshold in BOTH directions, which is why it is not
      called "problems"), and the page-owned `board` / `rank` / `group`
      through FilterShell's `persistKeys`. The names dodge keys other pages own:
      `buckets` (Campaigns' `objectives` is a different vocabulary), `board`
      (`view` is never persisted and is Library's grid/table), `rank`
      (`order` is Campaigns' COLUMN order).
    - **Filtering is a reading aid, not a different month**: the header's
      brand total is never recomputed from the visible rows, and the page says
      "Showing 2 of 4 platforms" when something is hidden.
    - **The summary strip** counts BUCKET rows — "N ahead · N on track · N
      behind" — and a row with no verdict is counted in none of them. The
      behind chip is the page's one shortcut: it applies the off-pace filter
      (the same filter the bar's chip shows and clears), and the counts
      deliberately IGNORE that filter so the chip you clicked can take you
      back.
    - **Row order (`?rank=`) defaults to BY PLAN SIZE** — the earlier
      predictability-beats-drama decision stands; "Most off-pace first" is a
      choice, not the default.
    - **The bar says three things at once:** the TRACK is the row's full-month
      plan, the FILL is actual month-to-date, and the TICK is where the plan
      curve says today should be. Pure CSS, tokens only (surface-2 / brand /
      ink-3), warn-tinted by |deviation| through the shared threshold. The tick
      stands 4px PROUD of the track — against the fill it is nearly invisible
      (1.06:1 on Midnight), and it is the whole point of the bar. Every bar
      carries an aria-label that says the numbers in words.
    - **A row with no plan gets NO bar** — there is no track to draw against.
      Unplanned spend is an amount-only line per platform: on a PLANNED
      platform it names the bucket(s) with no allocation (objective drift); a
      platform with no plan at all "draws down the reserve" — the same
      platform-level reserve rule Overview's reserve row uses (2026-10-17).
    - Past month → the tick sits at 100% and the projection is replaced by
      "final for <month>"; future month → tick at 0, no verdict at all (nothing
      is expected yet, which must never read as 100% behind). Both fall out of
      `elapsedDaysInMonth`, not a special case.
  - **PLAN MODES (2026-09, migration 0048 additive) — a month is planned
    EITHER by the curve system OR by explicit day cells, ONE MODE AT A TIME.**
    `budget_targets.plan_mode` (`'curve'` | `'daily'`, app-side enum
    `PLAN_MODES`; DEFAULT `'curve'`, no backfill — no targets row = curve).
    - **curve** = everything above, UNCHANGED: the cascade editor, Move money,
      the day-weight calendar.
    - **daily** = `budget_plan_days` (day × platform × bucket, USD, sparse),
      landed ONLY by the sheet upload (and copy / restore of a daily plan). The
      revenue link is `budget_targets.target_roas` in the brand's ROAS
      convention (`roasThroughRate`: SAR revenue ÷ (USD spend × rate)), so
      revenue on day d = spend_d × ROAS × rate. A daily month's
      `plannedRevenueSar` is DERIVED at read time (cells × ROAS × the CURRENT
      rate — retroactive like every SAR figure here); the stored column is a
      write-time echo, never the truth.
    - **THE UNIFIED PLAN SERIES is the load-bearing abstraction.**
      `buildPlanSeries` (pure, lib/budget.ts) → per-day planned spend for any
      combo slice, per-day planned revenue, the month's pacing shape
      (`fraction`), plan-to-date and the projection;
      `planSeriesForMonth(month)` is the server entry, and client components
      build the same series from the `getBudgetMonth()` payload
      (`planSeriesSourceOf`). **EVERY consumer of plan-to-date reads through
      it** — Tracker (`buildTrackerRows`), Pacing (`stitchPlanByDay` now
      stitches SERIES, so a range spanning a curve month and a daily month is
      honest), Overview's verdicts/projections/"planned today", the allocation
      check — and so will the phase-3 alert evaluator. **Never expand a curve
      (or read day cells) in a page again.** Curve months delegate to the old
      functions and are pinned BIT-IDENTICAL (`toBe`, not `toBeCloseTo`);
      daily months read their cells verbatim, their `fraction` is the cells'
      cumulative share (linear when the month plans nothing), and a slice's
      plan-to-date is its OWN cells — `spendToDate(plan, …)` ignores `plan` in
      daily mode, which is why callers keep passing the curve's number.
    - **ALLOCATIONS ARE DERIVED SUMS in daily mode.** `replaceBudgetMonth` is
      the ONE plan writer (save, upload, copy, restore, convert all land there)
      and it rewrites `budget_allocations` as `allocationsFromDays(days)` —
      never trusting the client, which sends `allocations: []` — so every
      monthly-total consumer (copy, revision summaries, Overview's cards)
      keeps working without knowing modes exist. It
      returns the plan AS WRITTEN; callers snapshot that. A daily write leaves
      the day weights UNTOUCHED (dormant); a curve write CLEARS the month's
      day cells (the prior revision keeps them).
    - **One mode at a time, enforced twice.** `savePlanSchema.source` PINS the
      mode (editor ⇒ curve, upload ⇒ daily), and `saveBudgetMonth` refuses an
      editor save onto a daily month. The Plan tab on a daily month renders
      the mode badge, read-only totals (platform → bucket), the daily bars
      (`PlanDayBars`, the curve editor's bars lifted into budget-shared),
      Download sheet / "Upload new sheet…", and **"Switch to editor planning"**
      (`convertPlanToCurve`): the days COLLAPSE to their monthly sums, the
      curve resets to LINEAR (the dormant weights must not resurface), the
      ROAS becomes a plain SAR target at today's rate, mode → curve; the
      dialog says so, and the daily plan stays one restore away. No cascade,
      no Move money, no calendar on a daily month — **to edit it, re-upload.**
    - **Revisions carry the mode.** The snapshot gained `{ mode, days,
      targetRoas }`; legacy snapshots default to curve (which is what they
      were), and a restore re-applies the snapshot's mode. Copy of a DAILY
      month copies its days + mode (days past the destination's end dropped,
      allocations re-derived from the survivors) and the Copy dialog says so.
    - **SUPERSEDED (2026-09, user decision): "Start from shares" is GONE** —
      redundant since the editor's total-rescale. Copy is single-purpose
      again (replace with the source month's plan); the Plan page no longer
      fetches a seed month's plan, only its name for the empty state.
  - **THE SHEET (2026-09, day grain — SUPERSEDES 2d45cb3's monthly platform ×
    bucket template; there is ONE template).** Opened from a daily month's
    primary "Upload sheet", a curve month's ⋯ "Upload plan…", or the empty
    state (`budget.manage`), scoped to `?month=`. Rows: Day 1..N, then ONE Reserve
    row (one monthly USD amount, first value cell). Columns: `Day`, then one
    per platform × bucket headed "Instagram · Awareness (USD)" — DERIVED from
    `ALL_PLATFORMS` × `BUDGET_OBJECTIVES` (20 today) and the month's real
    length; never hand-list either axis (`lib/budget-plan-csv.ts`, pure).
    - **Prefilled from the plan series' source**: a daily month downloads its
      cells verbatim (generate → parse → generate is BYTE-EQUAL, pinned); a
      curve month downloads its allocations spread by the curve CENTS-EXACT
      (`splitByWeights`, so every column sums to its allocation and an
      unedited re-upload moves no cell) — seasonality already shaped.
    - **Parsing carries 2d45cb3's conventions**: the adapters' tolerant
      numerics (`csv/numeric.ts`), blank = 0, cell-named errors ("Row 4 ·
      Day 3 · Facebook · Activation"), unknown/duplicate row or column = ERROR
      (never dropped; columns match by NAME, any order, trimmed and
      case-insensitive; only `(USD)` is stripped, so a `(SAR)` column is
      unknown on purpose), short rows padded / long rows refused, absent
      Reserve row = 0 with a notice. The Day column must be EXACTLY 1..N once
      each (missing days listed as ranges). **Validation is FORM validation,
      deliberately NOT the E/S catalog** — that catalog is the ingestion
      pipelines' contract (stable codes, per-row reports, a spec); this is one
      person typing a plan into a grid.
    - **The dialog.** Revenue is DUAL-ENTRY — "Revenue target (SAR)" ⇄
      "Target ROAS", linked live through the sheet's planned spend and the
      brand rate (the reserve's USD ⇄ % pattern: only the typed field holds
      raw text, no caret fights). The ROAS is what's STORED (8 dp — at 4 a typed SAR 100,000 read
      back as 100,000.99), so the
      preview shows the target exactly as it will read back. Preview:
      per-platform × bucket monthly totals diffed against the current plan in
      the revisions drawer's language, the daily bars, the USD + SAR tripwire
      totals, the day cells changed, and — on a curve month — "This switches
      <Month> to day-by-day planning; the editor and curve become read-only
      for it." Confirm = `saveBudgetMonth({ mode: "daily", source: "upload",
      days, targetRoas, … })`, audited `op: "upload"`; the revision note
      pre-fills "Uploaded from file". papaparse is `import()`ed inside the
      file handler (not in the page's first load) and a `.xlsx` goes to
      `readSheetRows` instead — same parse layer, server-side, so the bundle
      never gains a workbook reader; a reader notice joins the plan's own
      notices above the preview; the preview needs
      `min-w-0` on its ancestor because `DialogContent` is a grid.

  - **DELETE PLAN (2026-09) — through the one writer, recoverable.** ⋯ menu,
    `budget.manage`. It is `saveBudgetMonth` with `source: "delete"` — an
    EMPTY full-replace (allocations [], cells cleared, revenue null, reserve 0,
    weights cleared, mode → curve, ROAS null), never a parallel DELETE. The
    schema refuses a "delete" that carries any plan, and a month with nothing
    to delete. Because it is the writer, it leaves a revision like every
    write, audited `op: "delete"`, note pre-filled "Plan deleted". **The
    safety story is Revisions**, so the confirm says "Deletes <Month>'s plan
    entirely. Recoverable — the previous plan stays in Revisions." — the house
    destructive dialog, NO type-to-confirm (that is for the unrecoverable
    cleanup tools). To keep that promise TRUE for plans that predate
    revisions (or whose latest revision no longer matches), the delete writes
    a "Before deletion" snapshot first, in the same transaction.
    `insertPlanRevision` stamps `clock_timestamp()`, not the column's `now()`:
    `now()` is the TRANSACTION's start, so those two revisions tied and the
    drawer's order was arbitrary. Restore round-trips a deleted daily month
    (mode, cells, ROAS) as well as a curve one — DB-pinned.
  - **THE PLAN TOOLBAR — the pattern for action-heavy tabs (2026-09, user-
    approved).** `[rate inline edit] · [currency toggle] · [Revisions] ·
    [PRIMARY] · [⋯ More]`: settings stay tiny and inline, ONE primary per
    mode, Revisions always visible, everything rarer in the house
    DropdownMenu (keyboard-reachable; the destructive item uses the
    primitive's `variant="destructive"` after a separator).
    - Curve month: primary **Edit plan**; ⋯ = Upload plan… · Copy from
      month… · Download sheet · — · Delete plan.
    - Daily month: primary **Upload sheet**; ⋯ = Download sheet · Copy from
      month… · Switch to editor planning · — · Delete plan. The "Day by day"
      badge sits first in the bar — it describes the month, it isn't an action.
    - "Download sheet" is the same client-side template the dialog offers (a
      curve month downloads curve-expanded — useful standalone).
    - Primary + ⋯ are ONE inline group, so a phone wraps them together. Edit
      mode swaps the whole group for note · Discard · Save, as before.
    - The menu is `modal={false}`: its items open Dialogs, and a modal menu
      closing underneath one can leave the body's pointer lock behind.
    - The upload dialog is CONTROLLED (opened from three places) and remounted
      per opening (`key`) — that is its reset.
    - The empty state follows the same hierarchy: **Edit plan** (primary) ·
      "Copy <month>'s plan" (when an earlier plan exists) · Upload.

  - **THE OVERVIEW REBUILD (2026-10-17, user decision) — fewer, stronger
    elements; one chart; the pace board.** The page had grown four metric
    tiles, a verdict line, a reserve strip, a revenue strip that repeated the
    tiles, per-platform cards with two numbers and a dot, and an allocation
    table that was the Tracker's table transposed — and no chart. It is now,
    top to bottom: the month bar with the Tracker's own coverage line ("Day N
    of M · data through D", laggards named — `CoverageLine` /
    `CoverageLaggards` in budget-shared, shared with the Tracker's header);
    three HERO CARDS (Spend · Revenue · ROAS) each with a big number, a
    context line, ONE bullet bar — the Tracker's `PaceBar`, lifted into
    budget-shared and extended with a projection extension, a dashed reserve
    tail and a ratio scale rather than forked — and a verdict line; ONE
    cumulative chart (ChartShell + MetricPicker Spend | Revenue | ROAS; the
    actual line stops at the side's coverage, the plan is dashed, a dotted
    projection runs from the last actual point to the SAME month-end number
    the card prints, a Today marker shows the upload gap; "Open in Pacing"
    links the month's range); and THE PACE BOARD — `buildTrackerRows`'
    platform rows sorted most-off-pace first (`sortTrackerPlatforms(...,
    "offpace")`), each with its bucket rows, a platform row opening the
    Tracker filtered to it, and the Reserve as the last row (used of reserve,
    "past the reserve" when over). **ROAS has equal billing** because the user
    may miss the whole spend or the whole revenue but must follow the ROAS
    target: target = revenue target ÷ (planned spend × rate) on a curve month,
    the stored target on a daily one (`roasFigures`); its bar is a 0..max×1.15
    axis with the target as the tick; projected ROAS = projected revenue ÷
    (projected spend × rate). Current month only for verdicts and projections;
    a past month's cards say "final for <Month>"; a future month shows plan /
    target with no fill and no verdict; a card with no plan shows the actual
    and "no plan" / "no target". **Every number is `buildTrackerRows`** (the
    hero total IS `t.total`, the projection IS `t.projectedSpend`;
    `projectedRevenue` and `reserveUsed` joined `TrackerData` for it) or the
    plan series (`cumulativeSums`, `cumulativeRoas`, `monthChartPoints` — pure,
    unit-tested); per-day actuals are `budgetPacingSeries(monthStart,
    monthEnd)` fetched in the page beside `getBudgetMonth` — no new scan. The
    rebuild also fixed a latent bug: the old page passed platform coverage
    WITHOUT the store key, so its revenue verdict was always null in the
    current month; the page now builds the same coverage map the Tracker does.
    - **The reserve rule changed with it (user decision, 2026-10-17).** "Used"
      had been the sum of actual spend on platform × objective combos with no
      plan row. September's local data showed Facebook UNDER its plan yet
      "past the reserve", because its campaigns sat in a different objective
      bucket from the one planned. The new rule is platform-level —
      `reserveUsed(allocations, actualSpendByCombo)` = Σ platforms max(0,
      actual − planned) — and bucket-level mismatch is objective DRIFT, named
      as such on the Tracker ("Unplanned $X — no allocation for Other") and
      visible in the Tracker table's objective grouping. Everywhere "reserve
      used" shows reads the one helper: the Overview's reserve row and its
      spend card's "within reserve / over even with reserve" note, the
      Tracker footer ("Used $X — past the reserve"). `unplannedTotal` is still
      reported (it is the drift total) but no longer drives the reserve.
  - **Funnel audience (`/budget/audience`, 2026-09, migration 0042 additive).**
    Hand-measured audience sizes per funnel stage × platform, versus spend.
    **Stages DERIVE from `BUDGET_OBJECTIVES` minus "Other"** (`FUNNEL_STAGES` in
    `lib/audience.ts`) — Awareness/TOF · Activation/MOF · Retargeting/BOF; never
    re-list them. Permission `audience.manage` (NOT in the editor preset — the
    measuring chore and planning authority are different jobs); audited
    `audience.record`/`update`/`delete`. Spend is the module's RAW basis and
    comes from `budgetPacingSeries` — never add a second spend scan. USD only
    (no currency toggle: pressure is a ratio). See the Learned entry for the
    sparse-snapshot semantics, and tech-spec §5e.
