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
  `useNavTransition`, or the progress bar never shows.
- Nav is ONE source (`nav-items.ts`) for both the desktop and mobile navs.
- Empty states are designed, numbers are tabular, dash means NULL.
- A horizontal scroll box that holds `sr-only` text is `relative`, or the
  label escapes it and widens the page at 375px.
- To reveal an item inside a scroll box, set THAT box's `scrollLeft`/
  `scrollTop` — never `scrollIntoView`, which scrolls the window too.
- A person's picture is `UserAvatar` (components/user/user-avatar.tsx) —
  photo, else initials; never a hand-rolled avatar (2026-10-20).

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
  - **DEFERRED (its own session):** migrate `campaign-funnel-table.tsx` (330 loc,
    own sort + drag-resize) onto `DataTable`. This is a large rewrite of a live
    table and warrants a dedicated, carefully-verified change rather than being
    bundled into the consistency sweep. (`launch-fatigue.tsx` was the other one
    and LANDED 2026-10 — see the phase-3 entry.)


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
  | Exclusions**. Permissions are UNCHANGED — the same key gates each tab
  (`catalog.products`, `catalog.angles`, `config.mappings`, `config.store`).
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

