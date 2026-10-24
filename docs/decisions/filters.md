# Filters, ranges and saved views

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- **Never hand-roll a filter bar.** Every filter-bearing page is on
  `FilterShell`; `FilterStrip` (the shared Dashboard/Trends strip) is a
  different thing.
- **Adding a filter to a page is adding ONE `FilterDef` — zero shell edits.**
  The shell derives the panel row, the chip, the badge and the presentation.
- **Clear clears tier-2 filters and nothing else** — never sort, columns, the
  saved view, the date range or any tier-1 control.
- A VIEW SWITCH is not a filter, and the Excluded toggle is a data-scope
  switch, not a filter. Neither is ever a `FilterDef`.
- **Every range and every main filter resolves SERVER-side**
  (`resolvePreferredRange`, `resolveFilterPrefs`): pass RAW search params, never
  validator output, and hand the resolved values BACK to the bar — a filter the
  query ran and the chips don't show is the same lie as a label that lies.
- Precedence per key: **URL → preference → page default**, with two central
  suppressions — `sv` (a saved view owns its state, including what it omits)
  and `fx` (this URL states its filters in full).
- A CLEARED filter DELETES its row; that is what stops a filter resurrecting.
- **A comma-list param drops only its bad tokens** — ONE helper, `csvEnum`
  (`validators/shared.ts`), on every page: `platforms=meta,instagram` reads
  `["instagram"]` everywhere, and a saved Ads view naming a retired column
  keeps its other hidden columns (W3-1, pinned by `validators/shared.test.ts`,
  which also fails if a validator declares its own copy).
- `useFilterParams` is the only URL writer, and writes made in one tick COMPOSE
  — without that, Clear's one-write-per-filter loses all but the last.
- A saved view with an empty config applies via `?view=none`, never a bare URL,
  or the default-view redirect bounces it back.
- **The date range and the Excluded toggle are WRITE-THROUGH** (W2-1,
  2026-10), like the remembered filters: the control's URL write is the one
  render, `setPreferredRange` / `setIncludeExcludedPref` revalidate nothing, and
  the picker never refreshes. The write is sent a task AFTER the URL write
  (`lib/pref-sync.ts`), never before it, or Next refreshes the page again.
- **A bare page restored by Back/Forward catches up ONCE.** The router cache
  restores a page as it was rendered; if this tab saved a newer range or
  Excluded choice since, the control showing the resolved default sees the
  difference on MOUNT and `router.refresh()`es — once per (URL, value)
  (`useRangeCatchUp`, `useExcludedCatchUp`). Never on a re-render: right after
  a pick the control re-renders with the old props while its navigation is
  pending.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Server-resolved ranges + remembered filters

<!-- was CLAUDE.md L443–468 -->

- **Every DateRangePicker page resolves its range SERVER-side through
  `resolvePreferredRange` / `defaultDateRange` (or its own concrete equivalent)
  — the picker never invents a display default the query didn't run.** The
  picker derives a DISPLAY default client-side (`from/to ?? fallback ??` last-7),
  so a page that passes RAW optional search params to its queries makes the
  label lie: the condition builders only bind when a value is present, so a
  fresh URL ran LIFETIME while the control said "Last 7 days". That shipped on
  `/store/reconciliation` (aggregate numbers claiming a window they never had)
  and `/store/orders` (every order ever, with the count header, pager and CSV
  all following the wrong set) and was fixed 2026-09-19 by resolving on the
  server and feeding ONE range to both the queries and the picker (`fallback`).
  A saved "lifetime" preference decodes to the concrete floor→today range, so
  the picker then honestly says Lifetime. **A new range-filtered page must
  follow this or its label lies**; cleanup tools are the one sanctioned
  exception — their picker IS the filter state (seeded client-side), not a
  window a query silently widened.
  **This generalized in 2026-09 to EVERY main filter** (migration 0049,
  `resolveFilterPrefs`): the same URL → saved preference → page default
  resolution, run on the server, for platforms/status/product/type/angles/
  priority/stage/objective/rate — and the same two rules follow it. Pass the
  RAW params (a validator's output is already defaulted and masks the
  preference), and hand the resolved values BACK to the bar (`resolvedFilters`
  → `get(key)`), because a filter the query ran and the chips don't show is the
  same lie in a different control. See the FilterShell entry for the whole
  mechanism.


### Saved views + the default-view redirect

<!-- was CLAUDE.md L524–527 -->

- **Saved Summary Views + default-view redirect:** a saved view with an empty
  config (no filters) must apply via `?view=none`, never a bare `/summary` —
  otherwise the default-view `redirect()` bounces it back. `applyView()` in
  `views-control.tsx` handles this.

### FilterShell

<!-- was CLAUDE.md L1089–1253 -->

  - **Filters → `components/filters/filter-shell.tsx` (`FilterShell`), 2026-09.**
    ONE primitive owns a page's whole filter surface the way `DataTable` owns a
    table — bar, panel, mobile sheet and chips — so no two pages can drift
    again. **NEVER hand-roll a filter bar.** Every filter-bearing page is on it
    (phase 2, 2026-09): **Ads · Library · Campaigns · Canvas · Store orders ·
    Reconciliation · Budget Pacing**. (`FilterStrip` — the shared
    Dashboard/Trends strip — is a different thing: one bar shared BY many
    pages, not a page's own.)
    - **THREE TIERS.** (1) The page's 2–4 always-visible controls, passed as a
      `tier1({ fullWidth })` render prop into the sticky bar (`top-14 z-10`).
      (2) Everything else as a DECLARATIVE `FilterDef[]` — `{ key, label,
      type: "multi" | "single" | "custom", options, values, onChange }` (+
      `header` for a scope picker, `emptyHint`, `chipFormat`). (3) A chips row
      under the bar, only while tier-2 filters are on.
    - **THE ACCEPTANCE CRITERION (user requirement): adding a filter to a page
      is adding ONE FilterDef — zero shell edits.** From that entry the shell
      derives the panel row, the chip, the count badge AND the mobile
      presentation. Pinned by `filter-model.test.ts`, which adds a brand-new
      def to a config and asserts the badge, the chips and Clear all pick it up.
      The derivations live in `filter-model.ts` (pure, no React) so they can be
      tested in the node environment.
    - **PRESENTATION: a MASTER-DETAIL DIALOG (2026-09, user verdict — it
      replaced the F1/F2 popover panel AND the mobile sheet; there is ONE
      presentation now).** The Filters button opens a centered Dialog that goes
      full-screen on a phone.
      - **Level 1** is a settings screen, not a form dump: one row per def,
        full-width click target, `label · current selection · chevron`, with a
        muted "Any" when the filter is off. The summary is the SAME wording as
        the chip (`filterSummary` → `filterValueSummary`, which `chipFormat`
        overrides) — one source, so a row and its chip can never disagree.
        Footer: "Clear filters" (the chips row's semantics) and **"Done", which
        only CLOSES** — every change already applied when it was made.
      - **Level 2, two depths, chosen AUTOMATICALLY by `filterDepth`:** a short
        option list (≤ `POPOVER_MAX_OPTIONS`) drops a compact droplist anchored
        to its row, over the dialog — a multi keeps it open per toggle and the
        row's summary updates live; a longer list or a CUSTOM def drills the
        whole dialog to its own level (`← back · label · per-filter Clear`),
        with a search box past `SEARCH_MIN_OPTIONS` and the custom def's own
        component filling the body. No new config field — a def may set
        `depth` to force either way, and that hint is the only knob.
      - **ESC HAS DEPTH:** it dismisses a droplist alone, goes BACK from level
        2, and only closes the dialog from level 1. Focus returns to where you
        came from at every step (the row, then the Filters button — which is a
        real `DialogTrigger` so Radix restores it), arrow keys walk the rows,
        and the drilled level focuses its search box, else Back. The slide is
        `motion-safe:` only.
      - **The dialog needs ONE flex column inside it**: `DialogContent` is a
        grid, so at full height its rows distribute and the header floats
        mid-screen on a phone.
    - **CLEAR CLEARS TIER-2 FILTERS AND NOTHING ELSE** (user decision, 2026-09,
      closing July's parked item): never sort, columns, the saved view, the date
      range or any tier-1 control. It is enforced by construction —
      `clearFilters` only walks the declared defs, so there is no param list to
      drift — and pinned twice (`filter-model.test.ts`, and a source-level guard
      in `validators/summary.test.ts` that the Ads bar declares exactly its
      eight panel filters).
    - **The Excluded toggle is a DATA-SCOPE switch, not a filter** — it lives in
      the `toolbar` slot with the table controls (Columns, CSV, Sort, the
      grid/table toggle), stays visible house-wide, and Clear never touches it.
    - **ZERO-DEF PAGES** (Store orders · Reconciliation; Pacing was one until
      the Tracker's `buckets` / `offpace` moved onto it, 2026-10-19): a page with
      no tier-2 filters renders the SAME bar with no Filters button and no
      chips row — consistency without a dead control. With nothing to collapse,
      tier 1 simply wraps at every width instead of folding into the sheet.
    - **A VIEW SWITCH IS NOT A FILTER.** Reconciliation's mode toggle (user
      decision, 9c47d17), Pacing's group-by and objective breakdown, Library's
      Views control: page-owned tier-1 slots, never defs — so Clear leaves them
      alone and they stay visible.
    - **`active` overrides "something is selected"** for a filter whose DEFAULT
      is non-empty — Canvas's statuses default to all-but-terminated, so
      "active" is "the URL says something", and clearing writes nothing, which
      restores the default.
    - **`useFilterParams`** is the shell's URL writer: `router.replace`, empty
      keys dropped, `useNavTransition` for the progress bar — plus writes in one
      tick COMPOSE. Each write used to start from the render's `searchParams`
      snapshot, so Clear (one write per filter) had only its LAST write survive.
      Any multi-write action needs this; `nextQueryString` is the pure part and
      is unit-pinned.
    - **Ads (`/summary`) is the template** (migrated 2026-09): tier 1 = Views ·
      search · date · platforms (platforms picks the table's COLUMN GROUPS, so
      it is deliberately tier 1); tier 2 = status · product · type · angles ·
      priority · stage · rate · the metric-rule builder (a `custom` def that
      keeps its own component and contributes one chip per rule); toolbar =
      Columns · Excluded. **URL params are UNCHANGED** — every saved view keeps
      parsing, pinned by `validators/summary.test.ts`.
    - **Per-page tiers (phase 2).** Library: tier 1 Views · search · platforms,
      6 defs (product · type · status · angles · priority · stage), toolbar
      Sort · grid/table · Excluded — and the status FACET STRIP above the list
      is untouched: it is a summary of the listing that writes the same
      `statuses` param, so its chips simply light the shell's chip too.
      Campaigns: tier 1 Views · search · date · platforms, 2 defs (objective ·
      status), toolbar Columns · Excluded. Canvas: tier 1 date · platforms,
      3 defs (status · product · stage), toolbar Excluded — the canvas
      toolbar (node search, view switcher) is NOT the filter bar and is
      untouched. Store orders / Reconciliation: zero defs (Pacing has two
      since 2026-10-19).
    - **Tier 1 renders inline at every width** (it wraps on a phone) now that
      there is no sheet to fold into — the `fullWidth` ctx is kept for the
      controls that take it and is always false. `FilterSheet` survives only
      for `FilterStrip` (the shared Dashboard/Trends strip, which is not a
      shell consumer).
    - **ROW ICONS (2026-09): one map, keyed by the URL PARAM**
      (`filter-icons.ts` — `platforms`→Share2, `status`/`statuses`→Activity,
      `productIds`→Package, `types`→Shapes, `angles`→Tag, `priorities`→Flag
      (the priority pill's own mark), `stages`→Layers, `objectives`→Target,
      `rate`→Gauge, `channels`→Globe). A def may set `icon` and that WINS, but
      the default comes from the key, so the same filter wears the same icon on
      every page that has it — a page declares a filter, not a look. An
      unmapped key renders NO icon and the rows still align (the slot is
      reserved for the whole list or for none of it); `metricFilters` is the
      one deliberate bare row. Level 1 only — the CHIPS stay icon-free, since a
      chip is already the filter's name and value. `filter-icons.test.ts` pins
      every declared def key to the map, so a new filter can't ship without
      one.
    - **REMEMBERED FILTERS (migration 0049, 2026-09, user decision).** Every
      main filter persists PER USER, PER BRAND and applies again wherever the
      SAME key exists — the date-range rule, generalized ("apply it when that
      exact filter exists, otherwise don't"). It is sharing by KEY, so the Ads
      stage filter is the Library stage filter and nothing has to be declared
      twice.
      - **Who participates:** the tier-1 `platforms` control on every shell page
        + every STANDARD tier-2 def (status per its own vocabulary, product,
        type, angles, priority, stage, objective, rate). **Excluded:** custom
        defs (`FilterDef.persist` defaults `true` for standard, `false` for
        custom — the metric-rule builder is not remembered), and, centrally,
        `NEVER_PERSIST_FILTER_KEYS` (search, sort, columns, views, group-by,
        the date range and the Excluded toggle, which have their own older
        mechanisms on `users`). A page declares nothing: `FilterShell` derives
        the list from its own defs (`persistedFilterKeys`) and hands it to the
        writer as an ALLOW list.
      - **Storage:** `user_filter_prefs` — one row per (user, brand, key), the
        param's parts as `text[]`. A CLEARED filter DELETES its row; that is
        what stops a filter resurrecting itself. No audit rows (preference
        churn is noise — the same reasoning as notification reads).
      - **Resolution is SERVER-side** (`resolveFilterPrefs` in
        `db/queries/user-prefs.ts`): ONE read for all of a page's keys,
        `cache()`-deduped, then per key **URL → preference → page default**.
        Pages feed the result into their existing validators exactly where
        `searchParams` went before — pass RAW params, never validator output,
        or the defaults mask the preference. Id-shaped keys pass an `allow`
        list (products, angles): a remembered value that no longer exists is
        dropped silently, never queried.
      - **TWO SUPPRESSIONS, both central so no page can forget them.** A saved
        view owns the filter state, including what it leaves out — the
        default-view redirect and the Views control stamp `sv=<id>`
        (`VIEW_MARKER_PARAM`; NOT `view`, which is Library's grid/table mode),
        and removing the default restores preferences. And once the user
        touches any filter the writer stamps `fx=1`
        (`FILTERS_EXPLICIT_PARAM`) — from then on that URL states its filters
        in full and preferences are not re-applied on top of it. Both are
        transient: the Views control strips them before saving or comparing.
      - **Write-through lives in `useFilterParams`**, not in any bar: it diffs
        the params it started from against what it wrote and queues each
        changed key (`lib/filter-prefs.ts` — ~400ms debounce, one call per
        burst, merged by key, fire-and-forget, `console.warn` on failure, no
        `revalidatePath`). The baseline is the EFFECTIVE params (URL +
        resolved), and the write materialises them into the URL, so removing a
        remembered chip is a real change — a delete — and not a no-op.
      - **The chips never lie:** a bar reads its own params through
        `get(key)` (URL → the server's resolved value), so a bare URL shows the
        remembered filter as a chip, and with `fx` present the URL alone wins.
    - **Every migrated bar keeps its own q-adoption rule** (the input is the
      source of truth while typing; only a `q` change it did NOT originate is
      adopted) and writes the URL through `useFilterParams` and nothing else —
      pinned by `components/filters/migrated-bars.test.ts`, which also checks
      each bar's declared def keys against its params and every page's
      round-trip.

### The saved range sticks without three renders (2026-10, W2-1)

- **What the refresh was for.** The range was first remembered in a cookie
  (705ec53), which "didn't stick" — a client-side write plus Next's page
  cache; it was reverted (94d9cc1) and rebuilt on the `users` row (3210c24)
  with the brand-switcher pattern: await the action (which revalidated the
  whole layout), then `router.refresh()`. That made it stick, at a price: the
  URL navigation, the action's re-render and the refresh — three full renders
  per pick (~128 queries on the Dashboard instead of 40). The Excluded toggle
  paid two.
- **Why most of it was unnecessary.** Every dashboard page is dynamic and
  `staleTimes.dynamic` is 0 (no `experimental.staleTimes` in next.config), so
  the NEXT bare visit to any page renders fresh and reads the saved range from
  the row; the page the person is on already carries the range in its URL.
- **The one case the refresh really covered** is Back/Forward. A popstate
  restore never refetches: it re-renders the page from the client router
  cache, as it was — and the old refresh/revalidation had emptied that cache.
  Measured on the dev server after the change: /summary visited before a pick
  came back reading "Last 14 days" for one frame after the person picked
  "Last 5 days" elsewhere. `lib/pref-sync.ts` keeps what this tab wrote and,
  on mount, a control showing the resolved default re-reads the page once if
  it is behind; the sample then reads "Last 14 days" → "Last 5 days". The
  same holds for the Excluded toggle ("Excluded hidden" → "shown").
- **The second trap** was Next's action queue: the picker sent its write
  BEFORE its URL write, and a navigation that starts while an action is
  pending makes Next discard the action and refresh afterwards. The write now
  goes out a task later; the server log shows one GET and one render-less POST
  per pick. (The remembered filters' 400 ms debounce already avoided this.)
- Proven in a signed-in dev render: the picked range is the default on the
  next bare visit to another page, after a full reload, and on Back/Forward,
  and the same for the Excluded toggle.

### One comma-list parser (2026-10, W3-1)

- `csvEnum` had been copied into five validators and the copies disagreed:
  the Library's dropped only an invalid token (its comment recorded why — a
  legacy `platforms=meta` link must not disable the whole filter), while Ads,
  Dashboard/Trends/Funnel, Campaigns and Canvas still reset the WHOLE array on
  one bad token. Because remembered filters are shared by key, one stored
  value then read differently per page, and a saved Ads view naming a renamed
  column re-opened every identity column. The Library's behaviour won (it was
  the decided one); the Store and Budget `csvOf` copies, which already behaved
  that way, and Compare's platform parser now use the same helper.
