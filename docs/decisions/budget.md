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
- The revision drawer's "Vs the current plan" compares the MODE, the day
  cells and the target ROAS too — a daily → curve restore is never
  "Identical" — and a reserve-only month IS a plan (W1-13, 2026-10-23).
- A copy from a month with NOTHING to copy never reaches the writer — it
  refuses and leaves the destination untouched (W1-9, 2026-10-23: it used to
  wipe it, with no revision, while reporting "has no plan to copy").
- **Pacing compares against DATA COVERAGE, never the calendar**
  (`platformHorizons` → `makeCoverageDay`). A total is the SUM of its rows'
  expectations, not a second calculation over the whole plan.
  **Every surface, every number** (2026-10-23, W1-2…W1-4): Overview's cards
  and board, Pacing's range card, chart (incl. Deviation), period table and
  board, and Audience pressure anchor EACH platform to its OWN day — a range
  through `coveredThrough` (the month rule as a date: a month before today's
  is over and final) and `expectedPlanPerDay` (each platform's plan through
  its own day, totals re-summed from those). A pacing verdict compares
  actual with THAT; a full period's plan is a display figure only. ROAS cuts
  both sides at the EARLIEST of the store's and every reporting platform's
  day — revenue has no platform attribution, so it can't be cut per
  platform. Never read the latest platform's day as "the" horizon for an
  expectation; it is only the "data through" a footnote prints.
- The reserve is part of the total, carved out of it, and sits OUTSIDE the
  curve. Save is blocked below 100% — uncommitted money belongs in the reserve.
- **Reserve USED = Σ over platforms of max(0, actual − planned)**, where
  `planned` is the platform's whole allocation across its buckets (0 for a
  platform with no plan). Spend beyond the plan at PLATFORM level draws the
  reserve; money that lands in a different objective bucket of a planned
  platform is objective DRIFT — shown as an unplanned row — never a reserve
  draw. One helper, `reserveUsed`, and every "reserve used" on every surface
  reads it (2026-10-17, user decision).
- **Pacing verdicts are coloured by DIRECTION, never green/red.** Ahead reads
  in `--ahead` (a dedicated blue), behind in `--behind` (the theme's warn
  amber), on track muted; the magnitude threshold (`PACING_WARN_THRESHOLD`)
  decides only STRONG vs FAINT tint of that colour (faint = the same token at
  reduced opacity, never a new hex). One helper, `pacingTone`, returns
  direction + strength, and every consumer — Verdict, PaceBar, PacingDevCell,
  the Pacing deviation bars, the Tracker's chips, the reserve rows — reads
  it; the tokens reach code only through `lib/palette.ts` and the
  `text-/bg-ahead|behind` utilities (2026-10-19, user decision).
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
  section of 4 pages (`/budget` Overview · `/budget/plan` · `/budget/pacing` ·
  `/budget/audience`; `/budget/tracker` redirects to Pacing since 2026-10-19);
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
  **Pacing page** is a date range. Deviations everywhere are coloured by
  DIRECTION — ahead blue, behind amber, strong past the magnitude threshold
  and faint inside it (2026-10-19; warn-tinted by |magnitude| until then) —
  never green/red. Permission
  `budget.manage`; audit `budget.update`. Migrations 0035 + 0036 (additive).
  **Plan modes (curve | daily, 0048) — see PLAN MODES below; every
  plan-to-date number goes through the unified plan series.**
  - **The Plan tab is planning-only (2026-09).** `/budget/plan` carries intent
    and nothing else. The Actual, Pacing, Variance and Variance % columns and
    the "unplanned" ghost rows were REMOVED in 2026-09; plan-vs-actual lives on
    Overview and the Pacing page. `getBudgetMonth()` still returns
    `actualSpendByCombo` for its other callers — don't reshape it; the Plan
    page just ignores it.
    - **VIEW MODE IS VISUAL (2026-10-17, user decision: the table was "flimsy,
      mostly useless").** The Platform/objective · Planned · % share DataTable
      and its CSV are GONE (Download sheet covers export). Top to bottom: the
      targets strip (Total budget · Revenue target · Reserve amount + % of
      total · "Implied ROAS target <x>× at <rate>" — revenue target ÷
      (ALLOCATED spend × rate), the Overview's `roasFigures` reading, so the
      pages agree; a daily month shows its stored target ROAS in that slot,
      which is the same number by construction); a COMPOSITION BAR — one
      stacked bar of the total, planned platforms in `ALL_PLATFORMS` order in
      their `PLATFORM_COLOR` tokens, the reserve LAST as a dashed outline (the
      Overview hero bar's reserve-tail grammar), a segment under 6% keeping its
      colour but dropping its inline label, a wrapping legend (dot · name ·
      amount · % of total) and an aria-label saying the split in words;
      read-only PLATFORM CARDS in the editor's own 2×2 grid and geometry (so
      "Edit plan" turns the same cards into inputs) — dot + name, amount and %
      of total, a mini stacked bar of the objectives (`seriesColor` tokens),
      one row per planned objective (name · amount · % of the platform);
      unplanned platforms are not shown; a daily month's cards show the
      derived monthly totals. The plan curve panel COLLAPSES to one line —
      "Plan curve · every day equal" (`CollapsibleSection`, still opens) —
      while every weight is 1, and shows as before when weighted; in edit mode
      it is always open. The `#platform-<key>` anchor ids stay on the cards
      (nothing links to them any more since the Overview rebuild; they cost
      nothing). The toolbar, empty state, Copy, Delete, Upload, Revisions,
      the note field, Discard/Save and the `key={month}` remount are
      unchanged.
  - **The Plan editor is a TOP-DOWN CASCADE (2026-09; reshaped 2026-10-17):
    targets → shares of the TOTAL (the reserve first, then the platforms) →
    objective shares → day curve.** Percentages are the PRIMARY input; amounts
    are derived cents-exactly from them (amounts stay editable and
    back-compute their share against a held parent — the TOTAL for the reserve
    and the platforms, the platform for its objectives). Storage is
    unchanged: `budget_targets.reserve_spend_usd` holds the reserve's derived
    amount and `budget_allocations.planned_spend` (USD) the derived platform ×
    objective amounts — SAVE stores the derived amounts, EDIT reconstructs the
    shares from them (`sharesFromStoredPlan`: total = Σ allocations + reserve,
    reserve share = reserve ÷ total, platform share = Σ its allocations ÷
    total, objective share = allocation ÷ platform) at full precision, so a
    round-trip is exact (unit-pinned, reserve included). Pure helpers in
    `lib/budget.ts`: `splitTotalByShares` (ONE `amountsFromShares` over the
    total with the reserve as the first share, so reserve and platforms round
    together), `sharesFromStoredPlan`, `sendRemainderToReserve`,
    `distributePlatformsEvenly`, `allocatableFromTotal`, `amountsFromShares`,
    `shareFromAmount`, `sharesComplete`, `normalizeShares`, `moveMoney` — plus
    the cents-exact `splitByWeights`/`distributeRemainder` they build on.
    (`reserveShare`/`reserveFromShare` remain for the upload dialog's reserve
    field.) Never re-derive this math per component. Targets carries "Total
    budget", "Revenue target" and a live read-only "Implied ROAS target" =
    revenue ÷ (allocated × rate), "—" until both are set.
  - **The RESERVE is part of the TOTAL, not on top of it (2026-09 framing).**
    `allocatable = total − reserve`; the reserve is money carved out and not yet
    allocated. Storage (`budget_targets.reserve_spend_usd`) is UNCHANGED, and it
    still sits OUTSIDE the plan curve — the curve paces the ALLOCATED plan
    only. "Used" is the platform-level rule (`reserveUsed`, 2026-10-17): spend
    beyond a platform's whole plan draws the reserve down; a planned platform
    spending in a different bucket is drift, not a draw.
    - **The reserve is ENTERED as a share (2026-10-17, user decision: "the
      reserve should be within the percentages").** It used to be typed as an
      amount BEFORE the percentages (type a reserve, then split what was
      left); now it is one share of the total beside the platforms — the
      FIRST row of "Split the budget", labelled "Reserve — held back, not
      paced", with the same share-%/USD pair a platform has, no objective rows,
      allowed to be 0. Changing the total rescales the reserve with everything
      else (the focus note says so); Move money's semantics are unchanged
      (reserve → platform, platform → platform, new money → platform; dollars
      move, other platforms' dollars untouched) and its result is mapped back
      onto shares of the new total at full precision.
  - **Save is BLOCKED below 100% (user decision).** Reserve share + platform
    shares must reach exactly 100% of the TOTAL (2026-10-17; before that the
    platforms alone reached 100% of the allocatable) and every planned
    platform's objective shares must reach exactly 100%; the header counter
    reads "<sum> of 100%" over reserve + platforms, the banner names each gap
    (naming the reserve: "Shares of the total: 70.0% (reserve 10.0% +
    platforms 60.0%) — 30.0% unassigned"), and THREE fixers close it in one
    click: "Distribute remaining evenly" spreads the gap across the ACTIVE
    platforms only (never the reserve), "Send the rest to reserve" puts the
    whole gap in the reserve (offered only when the reserve can absorb it —
    an over-assigned split it cannot give back is not offered), "Normalize to
    100%" scales reserve and platforms together. Money not yet committed
    belongs in the RESERVE, never in a gap. Rounding must never block —
    `SHARE_EPSILON` tolerates float dust only, and derived amounts are
    cents-exact.
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
    - **PACING GOT ITS POINT BACK (2026-10-17, user decision: "visually rich
      but neat — where and when did we drift").** Three additions, nothing
      removed. (1) **A RANGE CARD** above the chart — the Overview's hero card
      (`Hero` / `HeroVerdict` / `anchorWords`, now in budget-shared) for the
      RANGE, following the active metric: the big number is the range's
      actual, "of <plan> planned for <range>", one `PaceBar` (track = the
      range's plan, fill = actual, tick = expected through COVERAGE, pale
      extension = projection) and the verdict line. Its numbers are the
      table's own totals — actual at the last known row, plan at the last row
      — with the expectation cut at the coverage DAY from the same stitched
      per-day plan the rows sum (equal to the totals row's plan-to-date under
      Day grouping; the honest number for a partial last Week/Month). The
      projection is actual ÷ (expected ÷ plan), only while the range's end
      lies past coverage; a fully covered range says "final for <range>"; a
      range with no plan shows the number and "no plan for this range"; a
      range that hasn't started shows the plan with a "planned" aside. ROAS
      is the ratio bar (0..max×1.15, tick = on-plan ROAS to date, both sides
      cut at the EARLIER of the two coverages).
      **[Superseded 2026-10-23 — see "Coverage on every surface" below.]**
      The spend side is now the BOARD's rows summed (each platform through
      its own day); "cut at the coverage DAY" above meant the LATEST
      platform's day, which read on-plan spend as behind whenever one upload
      lagged, and contradicted "a total is the SUM of its rows'
      expectations". ROAS's "earlier of the two" now includes every
      reporting platform's day. (2) **SPLIT BY: none ·
      platform · objective** (`?split=`, `PACING_SPLITS`, remembered through
      `persistKeys`) replaces the Totals / By objective toggle. Objective is
      the old breakdown unchanged; **platform** draws one series per platform
      in its `PLATFORM_COLOR`, each with its own dashed plan line from the
      stitched series' slice (`spendDays((pl) => pl === platform)` — never a
      curve expanded in the page), and one table block per platform in the
      objective blocks' shape — only platforms with a plan or spend in the
      range, in `ALL_PLATFORMS` order. **A platform split LOCKS the metric to
      Spend exactly like the platform filter** (same note, same disabled
      picker options): revenue has no platform attribution anywhere in
      Budget. (3) **A THIRD CHART SHAPE, DEVIATION** (`?shape=cumulative|
      period|deviation`, `PACING_SHAPES`, remembered): per-period actual −
      plan (since 2026-10-23 the plan EXPECTED of the period's covered
      days) as bars around a zero `ReferenceLine`, one bar series per split
      series, each BAR in its DIRECTION colour (ahead blue / behind amber)
      when ITS period's |deviation| ≥ `PACING_WARN_THRESHOLD` (through
      `pacingTone`) and the series colour otherwise; the tooltip shows actual, plan and the signed difference
      with %. A period past the side's coverage draws nothing (unknown ≠ 0);
      a period with no plan draws nothing and reads "—". ROAS has no
      per-period difference, so Deviation is DISABLED with a title saying why
      and ROAS on Deviation falls back to Cumulative. The table STAYS visible
      and unchanged in shape (it gained the platform blocks). The two params
      dodge keys other pages own (`split`, not `group`/`objectives`; `shape`,
      not `view`); there was no URL alias to keep — the old objective toggle
      was component state. Saved views were NOT enabled: the house Views
      control is a per-page tier-1 component (Ads · Library · Campaigns),
      so Pacing would need new UI, which the brief excluded.
    - **THE BOARD (2026-10-19, user decision — the Tracker merged in: "it
      should be richer, more informative … merge both pages").** Below the
      chart, for the RANGE (never month-only): one row per platform in scope
      — biggest plan first, unplanned last — with its stage rows beneath, in
      the Overview's grid grammar (label · bar · sparkline · figures; every
      bar starts at one x, every figure right-aligned in one fixed column at
      both levels), every bar a `PaceBar` with the projection extension, and
      two readings the Overview's board lacks: a SPARKLINE (the range's daily
      actual, solid, over its daily plan, dashed — the house `Sparkline` with
      its `compare` series on one shared y-scale, so a day over plan reads
      above the dashed line; empty past coverage; hidden below `sm`, where a
      phone-width bar has no room beside it) and NEEDED PER DAY ("needs
      $700/day": max(0, plan − actual) ÷ the days left after coverage — "—"
      once the range is covered, with no plan, or with nothing left). ONE
      MATH PATH: `buildRangeBoard` (lib/budget.ts) sums the SAME per-day maps
      the chart and the period table use — `buildSpendPerDay` /
      `buildPlanSpendPerDay`, keyed by total · objective · platform ·
      platform × objective — plan over the whole range, actual and expected
      through the platform's OWN coverage (`platformHorizons()`, which
      REPLACED the page's `dataHorizon()` read; the overall horizon is
      `latestCoverage` of it), deviation through `pacingDeviation`, projection
      = actual × plan ÷ expected while the range runs (`rangeProjection`);
      unit-pinned: for a single-month range the platform rows equal
      `buildTrackerRows`' for that month. A row that spent in a month it has
      NO plan for keeps its amounts and loses its verdict, projection and
      needed/day (`unplannedMonths`, the reason on hover) — the range card's
      own rule, so a six-month range with one planned month cannot read
      "+456%". The summary strip (N ahead · N on
      track · N behind, bucket rows; the behind chip applies the off-pace
      filter and the counts ignore it) heads the board beside its title —
      no sentence under it. The RESERVE row (the platform-level `reserveUsed`)
      is read when the range sits inside ONE planned month — the range's
      actuals, in scope, against that month's reserve — and is a dash with
      the reason on hover otherwise (a judgment call: a multi-month reserve
      has no honest single figure). Spend only: revenue has no platform
      attribution, and the range card carries Revenue and ROAS. READINGS are
      whole dollars (`formatSpend`'s `whole`); the period table keeps its
      cents. **Board | Table** (`board`, remembered, Board default; the
      stored values are the Tracker's `bars` | `table`): the table is the
      Tracker's DataTable over the board's rows — Plan · Actual · Expected ·
      Δ · Δ% · Projection · Needed/day — grouped by platform or objective
      (`group`, remembered; the allocation check's reading with the unplanned
      badge, objective mode opening grouped by identity; an objective
      subtotal's anchor is the LATEST of its platforms' coverage), totals
      pinned, CSV in the display currency, `TABLE_KEYS.BUDGET_TRACKER` kept
      so remembered column choices survive. Row order `rank` (plan | offpace)
      and the tier-2 `buckets` / `offpace` filters moved here under the same
      stored keys (Pacing is no longer a zero-def page); the platform filter
      is the shared tier-1 one. The per-period table sits under the chart in
      a `CollapsibleSection` titled "Periods", CLOSED by default, with its own
      CSV and columns key. Page order: controls → range card → chart (+
      collapsed Periods) → board. `components/budget/pacing-board.tsx` draws
      it; `budget-pacing.tsx` feeds it.
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
      0. Every pacing surface shares it: Pacing's board (both views),
      Overview's hero cards, chart and pace board.
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
  - **Tracker (`/budget/tracker`, 2026-09 → MERGED INTO PACING 2026-10-19,
    user decision: "if the tracker offers the same bar as the overview, why
    have it then?").** The route is a permanent redirect to `/budget/pacing`:
    `?month=` becomes that month's `from`/`to` (no month → Pacing's default,
    the current month) and every other param carries across verbatim, since
    Pacing reads the same keys — `board`, `rank`, `group`, `buckets`,
    `offpace`, stored preferences included. Its board, table view, summary
    strip and controls live on as PACING'S BOARD (below), range-based now;
    `buildTrackerRows` stays for the Overview; `PaceBar`, `Verdict`,
    `Amounts`, `CoverageLine` stay in budget-shared; the Budget nav lists four
    pages. The month-only rules it carried (the bar's four things, "a row
    with no plan gets no bar", the summary strip's counts, by-plan-size
    order) are the board's rules — see the Pacing entry.
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
    (2026-10-17, PR 3: `Hero`, `HeroVerdict` and `anchorWords` MOVED from
    budget-overview.tsx into budget-shared.tsx so the Pacing page's range
    card is the same card; `HeroVerdict` speaks a `state: live | final |
    future` + `finalLabel` instead of the month's three clocks, and the
    Overview renders identically.)
    - **The reserve rule changed with it (user decision, 2026-10-17).** "Used"
      had been the sum of actual spend on platform × objective combos with no
      plan row. September's local data showed Facebook UNDER its plan yet
      "past the reserve", because its campaigns sat in a different objective
      bucket from the one planned. The new rule is platform-level —
      `reserveUsed(allocations, actualSpendByCombo)` = Σ platforms max(0,
      actual − planned) — and bucket-level mismatch is objective DRIFT, named
      as such on the Tracker ("Unplanned $X — no allocation for Other"; the
      Overview says "Unplanned $X · Other" since the 2026-10-19 style pass) and
      visible in the Tracker table's objective grouping. Everywhere "reserve
      used" shows reads the one helper: the Overview's reserve row and its
      spend card's "within reserve / over even with reserve" note, the
      Tracker footer ("Used $X — past the reserve"). `unplannedTotal` is still
      reported (it is the drift total) but no longer drives the reserve.
  - **THE STYLE PASS (2026-10-19, user decision) — "structure good, style
    bad".** The user's review of the rebuilt Overview and the visual Plan page
    produced two rules and one pass. The rules: **Show, don't label**
    (ux-standards.md — when a sign, a colour or a position already says it,
    the word is noise) and **verdicts are coloured by DIRECTION** (ahead a
    dedicated blue `--ahead`, behind the theme's warn amber `--behind`, on
    track muted; the magnitude threshold now decides only strong vs faint —
    "warn-tinted by |magnitude|" is retired). `pacingTone` returns
    `{ direction, strength }`; `toneText` / `toneFill` in budget-shared turn
    it into classes (faint = the token at 70%, never a new hex); the bars take
    the direction colour only PAST the threshold and the brand colour inside
    it, and a projection extension is judged on its own question (projected
    vs the whole plan). The Verdict is "+$1,590 (+17%)" / "−$1,844 (−61%)",
    the word kept in `sr-only` text and the hover; `PacingDevCell` is "+12%".
    The pass: the Overview's pace board is ordered BY PLAN SIZE (unplanned
    last — the Tracker's default, so the two pages agree), loses its header
    sentence, and is ONE grid with a fixed figures column (every bar starts
    at one x; verdict and amounts right-aligned at both levels; labels muted,
    amounts ink); the chart caption is gone (the legend says it); the hero
    context lines dropped the words the number carries ("of $18,000 + $2,000
    reserve" stays, "store revenue target" and "allocated" went; ROAS keeps
    "target" because a ratio has no "of"); the reserve row's explanation is
    an ⓘ and "past the reserve" reads "−$300" in amber; "Unplanned $X — no
    allocation for Other" is "Unplanned $X · Other" with the sentence on
    hover. On Plan: the sentences under Targets and Split the budget went,
    the implied-ROAS formula, the reserve's "held back, not paced" and the
    curve panel's description are ⓘ tooltips beside their labels, "of total"
    after a share went where position says it, and the composition bar lost
    its header line (the strip above states the total). **`InfoTip`
    (`components/ui/info-tip.tsx`) is the ⓘ**: the house Popover + `title`
    pattern (there is no tooltip primitive) — hover reads the title, click /
    Enter / Space opens the popover so a phone reaches it, Escape closes it.
    Tracker and Pacing changed only through the shared pieces. Two review
    fixes rode in the same PR: every READING on the Overview — board verdicts
    and amounts, the reserve and unplanned lines, the hero verdict lines — is
    whole dollars / whole SAR through `formatSpend`'s `whole` option (`sar0`
    for revenue), while the hero big numbers and the Plan page keep their
    cents because those are exact facts; and a verdict whose shown percent
    rounds to 0% reads "on track" (`paceReadsOnTrack` / `pctReadsZero`, the
    one judgment the Verdict and `PacingDevCell` share).
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

### Coverage on every surface (W1-2…W1-4, 2026-10-23)

The system audit found the "behind every morning" bug back, on the page that
was supposed to have fixed it. Pacing's range card, chart and period table
expected the WHOLE plan through the LATEST platform's day — `latestCoverage`
of the per-platform read — so a platform whose upload lagged a week counted
its unreported days as $0: Instagram and TikTok, both exactly on plan, read
"−$700 (−16%)" on the card while both board rows and the Overview read on
track; with `platforms=tiktok` the card said −32% beside TikTok's own on-track
row (B-03). The range-card paragraph above ("expectation cut at the coverage
DAY") had documented the bug as the design, contradicting this file's own
invariant. Audience pressure had the same root (the global `dataHorizon()`).

Three more readings disagreed with the Overview for the same reason: the
Overview's ROAS card divided revenue through the store's last day by spend
through the ads' (a month exactly at 2.0× read 1.36×, −32% — B-04); a partial
last Week or Month was judged against its whole plan (on-plan October read
"29% behind" under Month grouping — B-05); and the board treated a finished
month as live, reading a platform that stopped on Sep 10 as "on track,
needs $100/day" for days already gone (B-14). The board's Table CSV also
wrote USD into a file named `…-sar.csv` (B-17).

The fix restores the rule rather than adding one. `coveredThrough` is
`coverageDayInMonth` as a date; `expectedPlanPerDay` keeps each platform's
plan only through its own day and re-sums totals and objectives from those
slices; the range card sums the board's rows; the chart's per-series lines
stop at each series' own day; the period table's "Pacing" column and the
Deviation bars compare with the expected map while "Plan-to-date" stays the
full plan as a figure; ROAS (Pacing's card and the Overview's card and chart
line) cuts at the earliest of the store's and every reporting platform's
day; Audience knows a pair's spend through its platform's day. Pinned by
rendered tests in `components/budget/budget-pacing.test.ts` (each failed on
the old code) and unit tests in `lib/budget.test.ts`.

Not changed: the period table's and chart's ROAS ROWS (cumulative revenue
over cumulative spend per bucket) still divide each side through its own
day on a partially covered last row — flagged, not decided.

