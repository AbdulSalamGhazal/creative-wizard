# Tables and the columns system

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- **Every CSV export neutralizes formulas in TEXT cells (D4, 2026-10-23).**
  `lib/csv-export.ts` (`rowsToCsv` / `matrixToCsv`, behind every Download CSV
  button and the store orders export) prefixes an apostrophe to a text cell
  starting with = + - @ (or tab / CR), so a spreadsheet shows it as text
  instead of running it — store exports carry customer-typed text. Numbers,
  and numbers written as text ("-12.50"), are never touched. Never build a
  CSV outside those two writers.
- **Every `DataTable` passes a `columnsKey`** from the `TABLE_KEYS` registry,
  or appears in the coverage test's exemption list with a written reason.
- **The columns control lives IN the table's header row** (`TableCorner`) and
  costs zero vertical pixels. Never give it a row of its own again.
- HIDDEN-key semantics: a column absent from `hidden` is VISIBLE — **except a
  `defaultHidden` one, whose absence means HIDDEN and whose opt-in is stored
  explicitly as `!key`** (`SHOW_MARKER`), so a new catalog column cannot pop
  open for everyone who has ever set their columns.
- Precedence is ONE rule: **URL → applied saved view → preference → config**.
- Reset DELETES the row, and so does a state matching the table's own default.
  A preference write a NAVIGATION depends on is awaited; every other is
  fire-and-forget.
- **A table OFFERS every field its query already carries at the row's grain,
  `defaultHidden`.** The admission price is an existing SELECT (or a PK join
  off a column already read) — never a new scan or a per-row query. A field
  that costs more is excluded WITH its reason written down.
- **A PINNED COLUMN MUST FIT THE FRAME.** A sticky cell wider than the visible
  scroll frame stops pinning; free-text pinned cells carry a phone-only cap
  plus `truncate`, and a closed vocabulary needs neither.
- A GROUPED header is the only licence to leave `DataTable`, and the two twins
  (Ads summary, Reconciliation's Platforms) are the whole list.
- The consumer may keep the sort when the comparator is composite, when nulls
  must not sink, or when a CSV must export in the on-screen order — then no
  column carries a `sortValue`.
- URL-backed tables (Campaigns, Ads) are out of the catalog rule's scope: their
  columns live in saved views' query strings, which `defaultHidden` can't reach.
- **Presentation-only params are SHALLOW (D12, 2026-10).** A sort (Ads,
  Library, Campaigns) and the Ads column toggles rewrite the URL with the
  native history API (`lib/shallow-url.ts`) — no server render — and the
  table re-arranges the rows it holds, reading the URL live. The ORDER is one
  pure function per table that the server ALSO sorts with
  (`sortSummaryRows` lib/summary-sort.ts, `sortCreativeRows`
  lib/creative-sort.ts; Campaigns' `sortValue`s run in the same DataTable on
  both sides), so a fresh load and a click can't disagree. A sort click on
  Ads/Campaigns is a history entry (`push`); the Library's sort and the Ads
  columns `replace`, as their navigations did. Precedence is unchanged: what
  the URL states → a toggle made in this tab → the server's resolution
  (view → preference → config).

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### DataTable + the whole columns system

<!-- was CLAUDE.md L837–1077 -->

  - **Tables → `components/ui/data-table.tsx` (`DataTable<T>`).** The canonical
    flat-column table: controlled sort (`sort`/`dir` + `onSort`), drag-grip
    reorder (`order` + `onReorder`), drag-edge resize (internal/ephemeral),
    externally-controlled column visibility (`hidden`), Summary-style borders
    (`border-l` between columns + `divide-y` rows), sticky header/footer +
    sticky pinned first column, optional totals (`showTotals`), `onRowClick`,
    `rowClassName`. Columns are a typed config (`DataColumn<T>`:
    key/label/align/sortable/pinned/render/total/sortValue/defaultSortDir). The
    consumer owns sort/order/hidden state and backs it with the URL (for saved
    views — see the campaigns table) **or** local state (detail tables). On it:
    the **Campaigns** table (`portfolio-table.tsx`, URL-backed + views),
    **By-angle** (`angle-rollup-table.tsx`), **Video** (`video-diagnostics-table.tsx`),
    the **campaign row-data** table (`campaign-records-table.tsx`), and the
    creative-detail **campaigns/platform** table (`creative-campaigns-table.tsx`,
    local sort + a By campaign / By platform mode toggle; totals derived from
    component sums so they match across modes; row-click → campaign detail), and
    the **Library** table (`creative-table.tsx`, migrated 2026-09 — see below).
    The Columns dropdown lives in each consumer's toolbar and drives `hidden`.
    (The old hand-rolled `creative-platform-table.tsx` — expandable per-platform
    rows — was replaced by this and DELETED.)
  - **TABLE COLUMNS — ONE control, and it lives on the PRIMITIVE (2026-10,
    phase 1).** Every `DataTable` passes a **`columnsKey`** from the
    `TABLE_KEYS` registry (`lib/table-columns.ts`) and gets the control for
    free: one ghost button in the table's own corner, because columns belong
    to the TABLE, not to a page toolbar. **It is the ONLY columns UI**; the
    hand-rolled toolbar dropdowns are retired as each table migrates
    (Campaigns and Store orders already lost theirs), so never add a new one.
    The popover lists the live `DataColumn` config in display order — a page
    never lists its columns twice — pinned column first as a LOCKED row, and
    reordering is never drag-only (up/down buttons, Alt+↑/↓, Space to toggle).
    **Named exemptions:** none left since 2026-10-19 (Tracker's bars view
    until the Tracker merged into Pacing — Pacing's board is rows, not a
    DataTable, and its table view carries the control; the Budget plan editor
    until its view-mode table went in 2026-10); the grouped-header twins (Ads summary, Reconciliation's Platforms)
    are phase 2, not exemptions.
  - **IT LIVES IN THE HEADER ROW AND COSTS ZERO VERTICAL PIXELS (2026-10,
    user-reported).** It shipped as a slim row ABOVE the header, which added a
    whole line under every page's title and toolbar — a tax every page pays
    forever for a button most visits never press. `TableCorner` now floats it
    at the right-hand end of the table's own header row: positioned against
    the table FRAME, so it holds the right edge while the table scrolls
    sideways and stays over the sticky header while it scrolls down, with a
    backdrop (a label underneath must not smudge into it) and `pr-10` on the
    last header cell so they keep apart at rest. The grouped twins place the
    same corner themselves and give their first banner row the shared `h-8`,
    so it lands in the FIRST of their two header rows. **Never give the
    control a row of its own again** — `table-columns-coverage.test.ts` pins
    that every placement goes through `TableCorner`.
  - **The state is the filters' architecture, not a second one** (migration
    0053, `user_table_prefs`): per user, per brand, HIDDEN-key semantics (a
    column absent from `hidden` is VISIBLE, so a new column appears for
    everyone — EXCEPT a `defaultHidden` one, which is the opt-in marker's
    whole subject, below), `col_order` MERGED against the live config on read
    (`mergeColumnOrder` — stale keys dropped, new keys anchored to their config
    neighbours, never appended), server-side `cache()`-deduped resolution
    (`resolveTablePrefs`), and a debounced fire-and-forget write
    (`lib/table-prefs.ts`) through a self-only, registry-validated, NOT-audited
    action. **Reset DELETES the row — and so does an all-default choice**: the
    filters' cleared-row rule is what stops a preference resurrecting itself.
    **A preference write that a NAVIGATION depends on is awaited; every other
    one is fire-and-forget.** On a URL-backed table a reset strips `hide`/
    `order`, and a bare URL is indistinguishable from "no opinion" — so the
    server falls through to the preference and re-applies the row the user just
    cleared. `resetTablePrefsNow` therefore waits for the delete AND cancels any
    queued write for that table before the URL changes; per-toggle writes stay
    debounced and unawaited, because they never race a render that reads them.
  - **Precedence is ONE rule: URL → applied saved view → preference → config**
    (`resolveColumnPrefs`). A saved view owns the columns its query states
    INCLUDING the ones it leaves out, and it reuses the filters' `sv` marker —
    never fork a second suppression. A URL-backed table (saved views snapshot
    the query string) writes BOTH the URL and the preference on a change; a
    plain one takes the server-resolved value as `initial` and owns it from
    there. Both go through `useTableColumns`, whose `tableProps` spreads the
    whole control onto the table.
  - **PHASE 2 (2026-10) — the sweep is DONE; no table is off the system.** Every
    `DataTable` passes a `columnsKey`, every toolbar Columns dropdown is gone
    (Ads · Library · Store orders · Campaigns · Trends ×2 · Reconciliation), and
    `components/ui/table-columns-coverage.test.ts` fails the build if a table
    ships without a key, if an exemption goes stale, or if the retired
    per-browser hooks (`usePersistentHidden`/`usePersistentVisible`, deleted)
    come back. **The exemption list is EMPTY (2026-10-19):** Tracker's BARS view was
    the last (a chart made of rows; its table view carried the control) until
    the Tracker merged into Pacing, whose board is not a DataTable. The Budget plan editor was
    the other (an editor, not a data table — its columns were the plan's own
    axes) until 2026-10, when its view-mode table became a visual read with
    no table at all.
  - **The GROUPED twins keep their structure and share the button.** Ads lists
    platform GROUPS (reorder) plus the identity and per-group metric columns;
    a group is NOT hideable, because a group exists when the platforms FILTER
    selects it and two controls for one thing is worse than one. **Its four URL
    params are UNCHANGED** — `joinAdsHidden`/`splitAdsHidden` in
    `components/summary/summary-columns.ts` (a NON-client module, so the server
    page may read it) are the only translation, because every saved view is a
    stored query string. Reconciliation's Platforms hides its three leading
    context columns and reorders its groups; its four sub-columns (Store ·
    Claim · Δ · Δ%) are the comparison itself and never hide. Channels has its
    OWN key — a different column universe — and the mode toggle stays page
    state, because a view switch is not a column.
  - **Preferences reach the client through ONE read.** The dashboard layout
    resolves every table's preference (`cache()`-deduped) into
    `TablePrefsProvider`; a table reads its own entry by key. **A new table
    needs no page edit** — which also keeps server pages, and the RSC boundary,
    out of it.
  - **"Default" is the TABLE's default, not "nothing hidden"** (phase 2
    correction). Library, both Trends tables and Reconciliation's Channels ship
    with a collapsed tail as `defaultHidden`, so an EMPTY hidden set is a real
    choice there and is STORED. The decision moved to the client, which knows
    the config (`isDefaultColumnState`): `writeTablePrefs` always upserts, and
    a state matching the table's default routes to the DELETE instead.
  - **THE CATALOG IS THE AVAILABLE DATA, NOT THE CURRENT COLUMNS (2026-10,
    user-reported).** The control was only toggling the columns a page had
    already chosen to draw; the requirement was that it offers what the page
    HAS. So **a table OFFERS every field its query already carries at the
    row's grain, `defaultHidden`** — nothing looks different until somebody
    opts in. **The admission price is an existing SELECT (or a PK join off a
    column already read); NEVER a new scan or a per-row query** — `lib/db.ts`
    is `max: 1`, so a column is never worth a round-trip. A field that costs
    more is EXCLUDED and the reason is written down (tech-spec §UI) — that
    list is part of the rule, not a gap in it. **URL-BACKED tables are out of
    scope** (Campaigns, Ads): their column state is a stored query string that
    every saved view carries, so a new column there is visible-by-default by
    that contract and `defaultHidden` cannot reach it.
  - **A GROWING CATALOG NEEDS AN OPT-IN MARKER.** Plain hidden-key semantics
    say an unmentioned key is VISIBLE — right for a column that ships visible,
    exactly wrong for one that ships hidden, because the next catalog addition
    would then pop open for precisely the people who have ever set their
    columns. So for a `defaultHidden` column **absence means HIDDEN and the
    opt-in is stored explicitly as `!key`** (`SHOW_MARKER`):
    `mergeHiddenColumns` decodes once at the hook's seed, `encodeHiddenColumns`
    re-encodes on every write, a table with no `defaultHidden` behaves exactly
    as before, and the GROWN default is still the default (matching it deletes
    the row). One cost, accepted and written down: a preference saved BEFORE a
    table gained its `defaultHidden` set carries no markers, so a tail column
    that user had opened reads as hidden again — one click, once, on the four
    phase-2 tables that shipped a collapsed tail.
  - **PHASE 3 (2026-10) — the hand-rolled tables, one change each. DONE:
    Trends → Launches** (`launch-fatigue.tsx`, key `trends-launches`). **The
    WRAPPER still owns the sort**: `compareRows` is a ROW comparator — Status is
    a composite (tier → biggest drop → newest launch) that no scalar `sortValue`
    can express — so no column carries one, `DataTable` never re-sorts locally,
    and a window with NO ROAS still sorts as 0 rather than last (pinned in
    `components/trends/launch-fatigue.test.ts`, with the ASC-first set behind the
    exported `firstDir`). Window columns still derive from `FATIGUE_WINDOWS`.
    Three deliberate changes ride the house conventions: **Creative is PINNED**
    and therefore leads (it was second, behind Status — the table is wide and the
    identity must stay in view while the windows scroll), `border-l` between
    EVERY column replaces the bespoke borders-only-before-the-windows rule, and
    **widths are ephemeral** — `launch-col-widths` is retired and its stored
    values were NOT migrated, as the Library's and Store orders' were not.
    `LaunchFatigueSummary`, `DecayBar` and the legend are untouched.
    **Funnel → By campaign** (`campaign-funnel-table.tsx`, key
    `funnel-campaigns`): the same four decisions plus two of its own. The
    THREE-STATE header cycle is the pure `nextSort` — desc → asc → back to the
    table's default — because DataTable PROPOSES a direction and the consumer
    decides what the table does; a TEXT column therefore never shows
    descending, which is what it always did. **The totals row is untouched
    math:** `funnelTotals` keeps an unreported step NULL so it renders "—" and
    not 0%, and a source guard fails the build if a `?? 0` ever lands on a
    totals value. Catalog: clicks · LP views · revenue, `defaultHidden`;
    `funnel-col-widths` retired un-migrated.
    **Compare → A/B totals** (`compare-totals-table.tsx`, key
    `compare-totals`): flat, so the plain migration; `compare-totals-cols`
    retired un-migrated. **Nothing in it sorts** — the rows are the
    comparison's two SIDES, and ranking them would break the pairing the
    colours, the chart and the controls share. Its old DEFAULT_VISIBLE is
    DERIVED as `defaultHidden`, not restated. The catalog excludes
    `funnelCpm`/`funnelCtr`, the funnel-scoped twins of cpm/ctr, which beside
    them would read as a second, silently different CPM. The old
    refuse-to-hide-the-last-metric guard is gone; Reset covers it.
    **Dashboard → Top creatives** (`top-creatives.tsx`, key `top-creatives`):
    in `components/charts/`, but a real table with a real columns menu. **Two
    controls, two jobs** — the segmented RANKING control is page-owned and
    decides what "top" MEANS (cheapest-first for a cost metric; rows missing
    the metric last in BOTH directions; the limit applied after ordering, all
    pinned through the pure `rankRows`), the columns control is the table's,
    and nothing in the header sorts. The ranked metric is FORCE-SHOWN through
    the new **`DataColumn.lockedVisible`**, which also renders that row in the
    control WITHOUT a checkbox rather than with one that does nothing. The `#`
    rank folds into the pinned identity cell, because a separate leading
    column could only be pinned by making the ORDINAL sticky and letting the
    name scroll away.
    **Creative detail → its raw records** (`creative-records-table.tsx`, key
    `creative-records-detail`) — **the last one. No table in the app is
    hand-rolled any more.** Its all-or-nothing "All columns" button WAS a
    columns control, so it became `defaultHidden`: the same first view, but
    one field opens without the other eight. **The CSV stays the full record,
    in the ON-SCREEN sort** — which is why the wrapper keeps the comparator
    instead of handing sorting to the primitive. NULL still reads as ZERO in
    its sort. The Excluded BADGE moved into the pinned Date cell (the
    campaign-records precedent) so it survives a sideways scroll; the
    exclude/re-include ACTION is its own column, marked `lockedVisible`
    because it is the only way to exclude a record and a hidden action is one
    nobody can find. Catalog: the exclusion's own provenance
    (`excludedReason`, `excludedAt`) is offered now — the row always carried
    it, and it lived only in a tooltip.
  - **A PINNED COLUMN MUST FIT THE FRAME (2026-10).** A sticky cell wider than
    the visible scroll frame STOPS PINNING: past that width its left edge
    scrolls away and cannot be recovered, so on a phone the identity column —
    the one thing every other cell is read against — is the first casualty.
    Pinning is what makes a width cap load-bearing; an unpinned first cell
    never had to fit anything, which is why four tables inherited caps that
    had never been tested. Every pinned cell that renders FREE TEXT therefore
    carries a PHONE-ONLY cap (12rem, or tighter when the cell also holds a
    dot, an eyebrow or a badge; `sm:` restores the table's own cap, so desktop
    is untouched), and a cap needs `truncate` beside it or it simply overflows
    — the Library's name had `truncate` with no width to truncate AGAINST and
    looked capped for months. A pinned cell rendering a CLOSED vocabulary (a
    date, a platform, a bucket, a stage) measures 96–215px and needs nothing.
    Measured before → after at 375px scrolled fully right: Library 407/−81 →
    217/+1 · campaign creatives 423/−96 → 217/+1 · creative campaigns
    502/−176 → 225/+1 · by-angle 351/−25 → 201/+1 · Budget Pacing's week label
    plus its "through …" suffix 298 against a 291px frame.
  - **The LIBRARY table (2026-09) — DataTable, with three things worth keeping.**
    (1) **ONE comparator owns the order** (since D12, 2026-10: it was
    server-side SQL plus JS re-sorts). No column carries a `sortValue`, so
    DataTable never re-sorts on its own; `sortCreativeRows` (lib/creative-sort)
    owns the derived-status order, "unrated last" and "earliest stage,
    unassigned last", the server lists with it, and the table and the grid
    re-apply it to the URL's `?sort=` after a shallow sort click. Its header keeps the Library's
    THREE-state cycle (desc → asc → back to the page default) by interpreting
    `onSort` itself — DataTable proposes a direction, the consumer decides what
    the URL says. (2) **A Columns control** — the table's own corner button since
    phase 2 (per user per brand; the per-browser `usePersistentHidden` is
    gone and its localStorage values were NOT migrated), with notes / source
    link / thumbnail / created-by / created-at as its `defaultHidden`. A key
    absent from the stored set is VISIBLE, so a column added later still shows
    up. (3) **Cells
    that cannot grow the row.** `AngleChips` renders at most two width-capped,
    truncated chips plus a "+N" whose tooltip names the rest, and `StageChips`
    takes `nowrap`; measured against the built CSS, the Angles cell is 271px
    and the row 43px whether a creative has zero angles or eight long ones.
    **The CSV is deliberately NOT the visible column set** — it exports the
    whole record regardless of the menu (shape pinned by
    `creative-csv.test.ts`).
  - **THE GROUPED-HEADER EXCEPTION: the Summary table** (`summary-table.tsx`) is
    NOT on DataTable and shouldn't be forced onto it — its columns are
    per-platform GROUPS (a grouped header row), not flat columns, so it
    reorders/hides at the group level. It already shares the same visual language
    (borders, sort arrows, resize handle) — DataTable's border style was derived
    from it. Leave its structure; only keep the look in sync.
    **It gained a SIBLING in 2026-09: Reconciliation's Platforms table**
    (`ByPlatformTable` in `reconciliation-view.tsx`), where each platform is a
    group of four columns (Store · Claim · Δ · Δ%) — same reason, same visual
    language, deliberately denser (`text-xs`, `px-1.5 py-1.5`, compacted counts)
    so four platforms fit a 1366px desktop without horizontal scroll. These two
    are the WHOLE list: a grouped header is the only licence to leave DataTable,
    and a flat table that wants one should be re-thought, not hand-rolled.

### Sort and column clicks stopped being server renders (2026-10, D12)

- Every sort click and every Ads column toggle was a navigation: the page's
  queries re-ran and the whole row set came back — on Ads ~2 KB per creative
  per click (an estimated 0.3–0.5 MB at production volume) plus 15 queries,
  for an order of rows the browser already held. Now those writes are
  shallow (`history.pushState`/`replaceState`, which Next 15 syncs into
  `useSearchParams`) and the table re-arranges itself. What made it safe is
  that the order moved into PURE helpers the server uses too:
  `lib/summary-sort.ts` reproduces the Ads query's `ORDER BY` and its five JS
  re-sorts rule for rule (a metric's NULL as 0; Creator/Launch NULLs last
  ascending, first descending; Rate, Status, Priority, Stage comparators;
  ties by name), `lib/creative-sort.ts` the Library's. Text compares through
  one explicit collator ("en"), so the server, a browser in another locale
  and the database's collation no longer each decide. Measured on the local
  data: 15 Ads sort variants and 5 Library sorts list in the same order as
  before (the harness's client props, compared old vs new).
- The Ads table reads its columns from the URL when the URL states them, else
  from a toggle made in this tab, else the server's resolution; a copy
  restored by Back/Forward after a toggle that cleared every hide param
  re-reads itself once (`useRefreshWhenBehind`).
- Fixed on the way: the Library's 7d-spend header sorted by the 30-day
  column on its first click (`spend-desc` instead of `spend7-desc`).
