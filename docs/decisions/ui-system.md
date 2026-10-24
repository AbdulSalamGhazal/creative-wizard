# The UI system

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- Four themes on ONE axis (Midnight · Contrast · Frost · Paper); every data
  colour is a CSS var with a light-theme override.
- ONE UI font; there is no font switcher.
- Every route renders `PageShell` + `PageHeader`, ships a tailored
  `loading.tsx`, sets a `metadata.title`, and works at 375px.
- **Use the shared primitives; if one doesn't fit, EXTEND it — don't fork it.**
- Any component that drives a route or search-param change uses
  `useNavTransition`, or the progress bar never shows — except a SHALLOW
  presentation param (a sort, an Ads column toggle; D12, tables-columns.md),
  which rewrites the URL with the history API, renders nothing on the server
  and lands instantly, so there is nothing for a progress bar to report.
  Pinned by `components/nav-transition.test.ts` (W3-6): a bare
  `router.push`/`replace` fails the suite — the scatter points, the bell, the
  Compare metric blocks and the after-save navigations all bypassed it.
- Nav is ONE source (`nav-items.ts`) for both the desktop and mobile navs.
- **A gated nav item's permissions are DERIVED from its page's gates**
  (`NAV_ROUTE_GATES` in `lib/page-gates.ts`, where every gated page's tabs and
  actions are declared once and the pages filter with them) — never
  hand-listed. A page shows in the sidebar to anyone who can open or act on
  one of its gated parts, and to nobody it would 404 (D18, 2026-10; pinned by
  `components/layout/nav-gates.test.ts`).
- Empty states are designed, numbers are tabular, dash means NULL.
- A horizontal scroll box that holds `sr-only` text is `relative`, or the
  label escapes it and widens the page at 375px.
- To reveal an item inside a scroll box, set THAT box's `scrollLeft`/
  `scrollTop` — never `scrollIntoView`, which scrolls the window too.
- A person's picture is `UserAvatar` (components/user/user-avatar.tsx) —
  photo, else initials; never a hand-rolled avatar (2026-10-20).
- **ONE render per action (W2-1, 2026-10).** A server action that calls
  `revalidatePath`/`revalidateTag` (or writes a cookie) re-renders the
  CALLER's page and ships the tree in its response — any path, Next 15 does
  not match it. So: a caller that STAYS keeps the action's revalidation and
  never `router.refresh()`es after it; a caller that NAVIGATES away (create,
  delete, rename) uses an action that does NOT revalidate, and the navigation
  is the render. A preference write (range, Excluded, toast scope, filters,
  columns) revalidates nothing. Pinned by `app/actions/action-calls.test.ts`.
- **An action and a navigation never overlap in the router's queue.** Next 15
  discards a pending action's state and schedules a full `router.refresh()`
  when a navigation starts behind it (`needsRefresh`) — the destination
  renders twice. `lib/router-queue.ts` holds both cures: a caller that
  navigates after an action does so after `await actionSettled()` (the
  action's promise resolves a few microtasks BEFORE the router clears it); a
  fire-and-forget write paired with a navigation goes out behind it with
  `afterNavigation` (the date picker, the Excluded toggle, opening a
  notification; `lib/filter-prefs.ts` debounces). Pinned by
  `app/actions/action-calls.test.ts`.
- **Every client call to a server action goes through `safeAction`**
  (lib/action-failure.ts) and fails through `toastActionFailure`
  (lib/action-toast.ts) — a row toasts, a form shows it inline (`inline`), and
  a tab from before the last deploy always gets the persistent Reload toast.
  An editor, composer or dialog keeps the person's input on failure.
  `safeAction` lets a `redirect()`/`notFound()` through (sign-out). Pinned
  lexically by `app/actions/action-calls.test.ts`: every reference to an
  imported action in a client file sits inside `safeAction(…)`.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Theming — one axis, four themes

<!-- was CLAUDE.md L642–673 -->

- **Theming = one axis, FOUR THEMES** — two dark (**Midnight** default /
  **Contrast**) + two light (**Frost** cool blue-white / **Paper** warm cream).
  (2026-07: slimmed from eight — Slate/Carbon/Ocean/Sand/Rose were deleted and
  Paper added so the two light options read differently.) Each theme also sets
  its own accent (`--brand` / `--brand-2` + matching `--primary-foreground`), so
  the dominant UI color changes per theme; only the platform + pos/neg/warn
  chart colors stay shared. Managed by next-themes (`attribute="class"`,
  `storageKey="cw-theme"`, `defaultTheme="midnight"`, `enableSystem={false}`) →
  `class="<theme>"` on `<html>`. Midnight is the base palette in `:root`; every
  other theme is a `.<name>` class that overrides the surface/ink/line scale
  (the two light themes also re-tune pos/neg/warn + popover + the data-viz vars).
  Brand magenta and the four platform colors are shared so the charts look
  consistent — only the chrome re-tones. The `dark:` variant matches ONLY the
  dark classes (`.midnight, .contrast`); the light themes (Frost / Paper) are
  excluded so shadcn renders its light base styles there.
  - **Data-viz on light themes:** the grouped `.frost, .paper` block in
    `app/globals.css` overrides every series/product/type var (and tiktok +
    snapchat) with the ~600-level darker sibling so lines/swatches stay legible
    on white (verify new light data colors here).
  - **To add a theme:** add a `.<name>` palette override (+ pos/neg/warn +
    popover + the light-viz vars if light), add the name to `THEMES` in
    layout.tsx, add it to `@custom-variant dark` **only if dark**, add it to the
    `ok` valid-set in layout.tsx's stale-theme migration script, add an entry in
    theme-toggle.tsx (swatches mirror globals.css), and (if light) to
    `LIGHT_THEMES` in themed-toaster.tsx. Verify brand-on-surface and body
    ink-on-surface hit AA.
  - **Stale-theme migration:** a pre-paint inline script in layout.tsx maps any
    stored `cw-theme` that no longer exists BEFORE next-themes reads it —
    slate/carbon/ocean → midnight, sand/rose → frost, anything unknown →
    midnight (else the dangling class would silently render Midnight tokens
    while `dark:` no longer matched → broken mix). The same script drops the
    now-dead `cw-font` key.

### One UI font

<!-- was CLAUDE.md L674–679 -->

- **ONE UI font — no font switcher.** Plus Jakarta Sans is the only UI font
  (`--ff-jakarta`, which `--font-ui`/`--font-sans` point straight at);
  Instrument Serif is the display/heading font (`--font-display`); IBM Plex Mono
  is the mono. (2026-07: the old `data-font` axis with Inter / Space Grotesk was
  removed — dead vars, the `[data-font]` selectors, the `cw-font` key, and the
  ThemeToggle font section all deleted.)

### Screenshot to clipboard

<!-- was CLAUDE.md L696–706 -->

- **Screenshot-to-clipboard** lives in the top bar (`components/layout/
  screenshot-button.tsx`). It renders the live page DOM to a PNG via
  `modern-screenshot` (dynamically imported, so it's not in the initial
  bundle; chosen over html2canvas because the SVG-foreignObject path renders
  this app's CSS variables / `color-mix()` correctly) and writes it to the
  clipboard with the async Clipboard API (HTTPS + a user gesture, both
  satisfied), falling back to a file download otherwise. It captures the whole
  page (`document.body`); nodes with `data-screenshot-exclude` (the button
  itself) and the sonner toaster are filtered out. A browser web app CANNOT
  silently capture the OS desktop — that needs `getDisplayMedia`, which always
  shows a picker; this DOM-render path is the no-prompt option.

### Shared UI primitives — the umbrella

<!-- was CLAUDE.md L834–836 -->

- **Shared UI primitives — DO NOT re-implement these per surface.** A
  consistency pass unified table + chart-control patterns that had drifted
  (each page had grown its own). Use them for any new table/chart:

### Chart metric picker + series legend

<!-- was CLAUDE.md L1078–1088 -->

  - **Chart metric pick → `components/charts/metric-picker.tsx` (`MetricPicker`)**
    — one segmented control (wraps when many options). Replaced the old mix of
    native `<select>`, shadcn `<Select>`, and ad-hoc pill/segment groups. On it:
    campaign creative chart, trends type×platform, metric-over-time,
    creative-perf-line.
  - **Chart series legend → `components/charts/series-legend.tsx`
    (`SeriesLegend`)** — one toggle-chip legend for show/hide series (funnel rate
    lines, campaign creative lines). It renders BELOW the plot via `ChartShell`'s
    `legend` slot (in both the inline card and the fullscreen overlay), never in
    the header zone; a "Show all" reset chip appears (via `onShowAll`) while any
    series is hidden.

### Chart header

<!-- was CLAUDE.md L1254–1260 -->

  - **Chart header → `ChartHeader` in `chart-shell.tsx`** — the one canonical
    line-chart header row: Title (`text-sm font-medium text-ink`, sentence case)
    → MetricPicker/segmented control → right-aligned cluster (Group → Smooth →
    Expand; the Fit toggle stays a conditional in-plot overlay). Never hand-roll
    a chart header or put loose text/legends in it — every ChartShell chart uses
    ChartHeader so titles read identically and the plot's top edge never varies.


### Global navigation progress bar

<!-- was CLAUDE.md L1261–1273 -->

- **Global navigation progress bar.** App Router has no route-change events, and
  same-route filter/date/sort changes navigate via `useTransition` — which keeps
  the current page visible with NO built-in spinner (reads as "nothing
  happened" on a slow query). Fix: a thin brand top bar (`NavProgressBar` in the
  dashboard layout) driven by the `navProgress` store in `lib/nav-progress.ts`.
  Any component that drives a route/searchParam change must use
  **`useNavTransition()`** (a drop-in `useTransition` that reports its pending
  state to the store) instead of React's `useTransition`, OR wrap a bare
  `router.push`/`replace` in the `startTransition` it returns (see
  `portfolio-table.tsx`). All the filter bars, the date picker's parents,
  views-control, metric-filter, and the campaigns table already do. New nav
  components: use `useNavTransition` or they won't show the loading bar.


### UI consistency pass

<!-- was CLAUDE.md L1274–1345 -->

- **UI consistency pass (2026-07, COMPLETE — one sub-item deferred) added
  shared primitives; a fresh session must REUSE these, not re-invent them.**
  - **Data-viz colors are theme-aware CSS vars, driven from `lib/palette.ts`.**
    Series/product/type/platform colors are now `var(--series-N)` /
    `var(--product-N)` / `var(--type-*)` / `var(--instagram|facebook|tiktok|
    snapchat)` — NOT hex literals. `:root` holds the dark (400-level) values;
    the grouped `.frost, .paper` block in `app/globals.css` overrides each
    with a ~600-level darker sibling so charts stay legible on white. Recharts
    resolves `var()` in `fill`/`stroke`, and inline `style` resolves it too, so
    consumers just read the palette exports. Any NEW data color = a CSS var with
    a light-theme override (verify on Midnight + Frost + Paper + Contrast).
  - **`FUNNEL_METRIC_COLOR`** (lib/palette) is the single color-per-funnel-metric
    map (cpm/ctr/voc/atcRate/apRate/purchaseRate/cvr) — the dashboard funnel-rates
    card and the /funnel tiles + trend chart all read it; none collides with a
    platform hue. **`roas()`** in `lib/format` renders ROAS with the `×` suffix —
    use it everywhere ROAS shows.
  - **`PlatformDot`** (`components/ui/platform-dot.tsx`, size `sm|md`) is the
    canonical platform swatch — every hand-rolled dot span (charts, admin +
    detail tables, funnel, upload picker) is now on it; the only remaining
    `PLATFORM_COLOR` inline styles are the two per-platform progress BARS.
    **Nav is one source:** `components/layout/nav-items.ts`
    (`NAV_ITEMS`/`isActive`/`navSections`) drives BOTH the desktop `Sidebar` and
    the mobile `MobileNav` (hamburger + Sheet, `lg:hidden`, in the TopBar). Items
    carry a `group` (`ads`|`budget`|`store`|`admin`); `navSections()` buckets the
    visible items into the four labeled `NAV_SECTIONS` so both navs render the same
    eyebrow-labelled sections — restructure grouping there, never per-surface.
  - **`middleware.ts`** is the real auth boundary (Edge Web-Crypto HMAC verify of
    the `ccms_session` cookie); the dashboard layout check is now belt-and-braces.
  - **`MetricCard` has an `empty` prop** that suppresses the delta chip (no more
    red "Gone" on an empty range). All sticky filter bars sit at `top-14 z-10`.
  - **Page shell = `PageShell` + `PageHeader`** (`components/layout/`). Every
    route renders `<PageShell>` (space-y-6 + a width lane: `full`/`admin`=4xl/
    `form`=2xl/`import`=3xl + an optional full-bleed `filterStrip` slot that owns
    the old `-mx-6 -mt-6` hack) wrapping `<PageHeader eyebrow? backLink? title
    subtitle? rightSlot?>`. Don't hand-roll a page header or the filter-strip
    full-bleed again.
  - **Every route ships a tailored `loading.tsx`** composed from
    `components/layout/page-skeletons.tsx` (FilterStrip/FilterBar/Header/KpiRow/
    ChartCard/Table skeletons) — mirror the real page's shape, not a generic box.
  - **`ChartTooltip`** (`components/charts/chart-tooltip.tsx`) is the one Recharts
    tooltip surface (frosted popover); pass `className` for a width cap.
  - **shadcn `Card` is retheme'd** to `bg-surface`/`border-line`/`rounded-lg` +
    the p-4 (16px) padding system — DON'T re-add `className="bg-surface
    border-line"`. It and the hand-rolled `rounded-lg p-4` panels are now one
    system.
  - **Two micro-label tokens** in globals.css: `text-eyebrow` (10px/0.18em) and
    `text-label` (11px/0.14em). Use these, not ad-hoc `text-[10/11px] uppercase
    tracking-[…]`. Snap arbitrary `text-[12/13px]` to `text-xs`.
  - **`lib/metric-labels.ts` (`METRIC_LABEL`)** is the single source for metric
    column labels (Impr./Conv./Revenue …) — tables read it, never re-spell.
  - **`lib/format` additions:** `monthDay()` (UTC "Mon D"), `usdCompact`/
    `intCompact` (no private per-chart `Intl` copies). Dash (`—`) means NULL
    only — a real `0` renders as `0`/`$0` (usd/int already do this).
  - **Forms:** shadcn `Select` + `Label` via a local `Field` helper (model:
    `creative-create-form`). Form-level errors render INLINE in the bordered
    banner (`rounded-md border border-neg/30 bg-neg/5 …`); toasts are for
    row/background mutations only (curly `“…”` quotes). Real `<form onSubmit>`
    so Enter submits; never put `disabled` on an `asChild` `<Link>`.
  - **New surfaces MUST use the shared primitives** — PageHeader/PageShell,
    Panel/Card, DataTable, MetricPicker, SeriesLegend, ChartTooltip, PlatformDot,
    DeltaBadge, DownloadCsvButton, `lib/format` (incl. `roas()`/`monthDay`),
    `lib/palette` (incl. `FUNNEL_METRIC_COLOR`), `lib/metric-labels`
    (`METRIC_LABEL`) — never a hand-rolled local variant. Any new color is a CSS
    var with light-theme overrides verified on Midnight/Frost/Contrast; any new
    page ships its own tailored `loading.tsx` and works at 375px. If a primitive
    doesn't fit, EXTEND it — don't fork it.
  - **DEFERRED, then DONE:** `campaign-funnel-table.tsx` (330 loc, own sort +
    drag-resize) moved onto `DataTable` in 2026-10, like `launch-fatigue.tsx`
    — see tables-columns.md, phase 3.


### The IA pass — names, routes, settings

<!-- was CLAUDE.md L1911–1943 -->

- **2026-09 IA pass — page names, routes, and where settings live.** The
  sidebar's Ads group reads **Dashboard · Library · Ads · Funnel · Campaigns ·
  Canvas · Trends · Compare · Upload ads** (Canvas was added later in 2026-09;
  the rest of the order is unchanged). Three renames, and only
  ONE of them moved a URL:
  - **Library** — the Creatives page; the route really moved, `/creatives` →
    **`/library`** (`/creatives` and `/creatives/[name]` stay as PERMANENT
    redirects that preserve query params, so shared filter links and the
    detail pager's list-context still work).
  - **Ads** — `/summary` KEPT its URL (saved views hang off it); only its
    labels changed. The sidebar SECTION is also called "Ads" — that repetition
    is deliberate and user-approved.
  - **Upload ads** — `/uploads` KEPT its URL; labels only, symmetric with
    Store's "Upload orders".
  **Settings now live with what they configure**, as in-page tab rows built on
  the shared `components/layout/page-tabs.tsx` (which renders nothing when only
  one tab survives permission filtering): Library = *Creatives | Products |
  Angles*, `/uploads` = *History | CSV mapping* (the old **Platforms** tab is
  MERGED in as the mapping surface's readiness header), `/store/uploads` =
  *History | Order fields* (fields + the Reconciliation source mapping).
  Configuration (`/admin/catalog`) keeps exactly **Rate rules | Status | Brands
  | Exclusions | Notifications** (Notifications joined 2026-10; the row is
  `PageTabs` since W3-2). Permissions are UNCHANGED — the same key gates each
  tab (`catalog.products`, `catalog.angles`, `config.mappings`, `config.store`).
  Every retired `?tab=` value redirects to its new home (including `tab=tags`,
  for bookmarks predating the tag→angle rename), and `/admin/products` /
  `/admin/platforms` re-point. Two things deliberately did NOT follow the
  Library rename: saved views' internal `page` key stays `"creatives"`
  (invisible plumbing — changing it would orphan every saved Library view), and
  the MCP tools stay `list_creatives`/`get_creative` (the ENTITY is still a
  creative). Code identifiers for the Ads page (`SummaryTable`,
  `listCreativeSummary`, `validators/summary`) likewise keep the "summary"
  name — the route did not move.

### The tab row scrolls instead of wrapping (2026-10)

- The Library gained a fourth tab (Landing pages) and, at 375px, the shared
  `PageTabs` row wrapped "Landing pages" onto two lines — the row had no
  overflow rule because three tabs had always fitted. Extended, not forked:
  tabs are `whitespace-nowrap shrink-0`, the row scrolls sideways (scrollbar
  hidden, the cut-off last tab is the cue), and the active tab is kept in
  view on mount/switch by setting the ROW's `scrollLeft`. (The first version
  used `scrollIntoView`, which also scrolls the WINDOW — every Back
  navigation onto a tabbed page yanked the reader up to the tab row. Caught
  by the independent review, 2026-10-20: never `scrollIntoView` to reveal
  something inside a scroll box.) The border moved to an INNER row so each tab's
  `-mb-px` underline still lands on the line without giving the scroll box a
  1px vertical overflow. Every page using `PageTabs` gets the same behaviour.
- Same pass, a trap worth naming: an `sr-only` label (absolutely positioned)
  inside a horizontally scrolling table escapes the scroll box unless the box
  is `relative` — it is positioned against the page instead, and widened the
  375px page to 817px. A scroll wrapper that holds `sr-only` text gets
  `relative`.


### One render per action, and no action call can crash a page (2026-10, W2-1 + W2-2)

- **The double render.** Every edit used to render the page twice: the
  action's `revalidatePath` already re-rendered the caller's page into its
  response (Next 15 sets `pathWasRevalidated` for ANY path — it does not check
  that the path matches the page), and 54 callers then `router.refresh()`ed,
  fetching the same tree again. Create, delete and rename did it three times —
  a rename re-rendered the OLD address, which by then 404'd. Measured with the
  audit harness: a field edit on creative detail ≈ 63 queries (~29 waste), a
  brand switch 43 + 43, a date pick on the Dashboard ~128 instead of 40. The
  comments domain had already fixed its own half (comments-notifications.md,
  `comment-latency.test.ts`); this generalised it. The fix is the invariant
  above: stay → keep the revalidation, drop the refresh; navigate → the action
  doesn't revalidate (`createCreative`, `deleteCreative`,
  `commitBulkCreatives`, `createCampaign`, `deleteCampaign`,
  `commitStoreUpload`), and `patchCreative` / `updateCampaign` revalidate only
  when the name did NOT change.
- **The queue trap.** The date picker, once its refresh was gone, still cost
  two renders: it sent the preference write BEFORE its URL write, and Next 15
  treats a navigation that starts while a server action is pending as
  "discard the action, refresh afterwards" (`needsRefresh` in
  app-router-instance.js). The write now goes out a task later, behind the
  navigation, and the pick is one render (server log: one GET, one
  render-less POST). The same trap, the other way round, surfaced on the
  production-build walk: create, rename and delete each fetched the
  destination TWICE (a 13 KB navigation, then a 24 KB whole-tree refresh) —
  `router.push` on the line after `await` still lands while the router holds
  the action. Those callers (and sign-in, the campaign forms, the bulk import,
  the store commit) now `await actionSettled()` first; the bell and the
  notification centre navigate first and mark read behind it.
- **The crash.** 51 client callers awaited an action directly. A rejected
  call — a network blink, or (the common case, since `main` deploys several
  times a day) a tab from before the last deploy calling an action id the new
  server no longer knows — landed on the route's error boundary, and on
  creative detail took the header's multi-field draft and up to 5,000
  characters of notes with it; the top-bar callers hit `global-error`. Every
  caller now goes through `safeAction`; forms keep their input and show the
  failure inline via `toastActionFailure(…, { inline })`, rows toast, and a
  stale tab always gets the persistent "Wizard was updated — reload." toast.
  The guard reads every call lexically, so a new caller that awaits an action
  bare fails the suite.

### Chrome that only draws when opened loads when it's needed (2026-10, W2-8)

- The comment panel body (~2,300 lines: thread, composer, reactions, mention
  picker, markdown) and the ⌘K dialog (cmdk + both lists) were in every
  route's first download, though neither draws anything until opened. Both
  are now `next/dynamic` modules behind small eager shells
  (`comment-panel.tsx`, `command-palette.tsx`) that keep the toggle, the
  trigger and the shortcut. Each shell PRELOADS its module when the browser
  is idle (`requestIdleCallback`, a timeout on Safari) and the moment intent
  shows — pointer or focus on the toggle/trigger, ⌘/Ctrl going down — so a
  first open is as instant as before. The panel's loading frame has the
  body's shape and a working X; ⌘K draws nothing until ready.

### Two pages stream their sections (2026-10, D11)

- The Dashboard and creative detail showed one route skeleton until EVERY
  query was done — with one DB connection, the KPI tiles waited on the 25-odd
  chart and table queries below them. Each now renders its top in place and
  streams the rest through inner `<Suspense>` boundaries: the Dashboard's
  tiles (the KPI pair is started first, so it leads the connection's queue)
  then the overview; creative detail's editable header, then the pager, the
  analytics body and the records/activity. Each boundary's fallback is a
  skeleton of THAT section's shape and height (`dashboard-skeletons.tsx`,
  `creative-detail-skeletons.tsx`), and the routes' `loading.tsx` compose the
  same pieces, so the first paint hands over to streaming without a jump.
  The pager's skeleton keeps a working Back link. Total server time is
  unchanged; time to first content is what moved. Other pages keep their
  single route skeleton — streaming was decided for these two (D11).
- **The ⌘K creative list loads with the palette, not with the page (D13).**
  It was a query in the dashboard layout, shipped with every full render (up
  to 500 rows, ~85 B each) for a list most visits never open. `GET
  /api/palette` (`listCreativeOptions`) now serves it: fetched on idle or on
  intent with the dialog's code, kept per brand for the tab, and refreshed in
  the background on every open — so a creative made a minute ago is listed,
  which the layout props stopped guaranteeing once create/delete no longer
  re-render the layout (W2-1). The pages are usable while it loads; the list
  says "Loading creatives…", or "Couldn't load creatives · Retry".

### A formatter must render the same on the server and in the browser (2026-10, W2-10)

- The Dashboard hydrated with a mismatch in dev: the product donut's centre
  read "$78" in the browser and "$78.0" from the server, so React discarded
  the server HTML for the tree. `Intl.NumberFormat` with `style: "currency"`
  defaults its MINIMUM fraction digits to the currency's (2); with a compact
  maximum of 1, Node's ICU clamps the minimum to 1 and prints "$78.0" while
  browsers drop it. `usdCompact` / `sarCompact` now state
  `minimumFractionDigits: 0`, so both engines agree ("$78", "$1.2K"). Any new
  formatter that sets a maximum below the currency's default must set the
  minimum too (`lib/format.test.ts` pins these two).

### The sidebar reads the page gates (2026-10, D18 + W3-2)

- The nav's permission lists were hand-copied and had drifted from the pages.
  Every editor holds `record.exclude`, yet Configuration was not in their
  sidebar — while the refusal "Excluded by rule «…» — deactivate the rule in
  Configuration → Exclusions" sent them there. A user holding only
  `catalog.products`, `catalog.angles` or `config.mappings` saw
  "Configuration" and landed on its 404: those tabs had moved to the Library
  and Upload ads in the 2026-09 IA pass. `notify.manage`, `config.mappings`,
  `config.store` and `store.cleanup` holders could not find their pages at
  all. The fix moved every gated page's tab and action table into
  `lib/page-gates.ts`; the pages, the ⌘K palette and the sidebar all read it.
  Upload ads / Upload orders count only their GATED parts — their read-only
  history alone does not put them in a viewer's sidebar (unchanged).
- Same pass: Configuration's hand-made tab row became `PageTabs` (progress
  bar, nowrap, scrolls at 375px; it had five tabs where the docs said four).
