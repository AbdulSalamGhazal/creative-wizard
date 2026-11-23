# Canvas

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- The canvas is READ-ONLY FACTS: nothing is edited, nodes are not draggable or
  selectable, and no position is ever saved.
- **TWO CLOCKS, LOCKED.** The RANGE decides whether an edge EXISTS; the STATUS
  WINDOW decides whether it is LIVE. Never merge them.
- ONE aggregation scan builds every edge and both node sets; statuses derive
  from the cached status inputs — never another status scan.
- Node totals are the entity's TRUE range spend: the status filter and the
  scale cap HIDE things, they never restate a number.
- `@xyflow/react` has exactly ONE importer, lazily loaded — do not import it
  from a second module.
- The legend is non-optional, and a cap that bites must SAY SO.
- Nodes carry `measured`; the initial fit is done by hand in an effect — do not
  restore the `fitView` prop.
- **THE LENS RECOLOURS, IT NEVER RESTATES.** `?lens=rate` colours each pairing
  by its RATE — `pairRate` = the system's one rule (`rateBlock`) over the
  pair's own RANGE sums (Σrevenue ÷ Σspend), judged by the campaign platform's
  rules (`rulesForScope`: override, else the brand default), same min spend as
  Summary. No new scale, no CPA lens (no CPA thresholds exist). Width, dash
  and opacity keep their meaning in both lenses; liveness stays the window
  clock. A chip's `roas`/`rate` are its edge's, copied — never re-derived.
- **THE INSPECTOR READS THE DRAWN GRAPH.** A single click (or a search pick, or
  a pairing row) = focus + the click inspector (`inspectFor`): no query, no
  new number — ROAS / CPA from the node's sums, the pairing's ROAS and Rate
  from its edge. It is NON-MODAL: a column beside the canvas from `sm` up, an
  overlay on the lower 55% below it. Opening it never re-flows the clusters
  (`reservedWidth`) and keeps the inspected node in view (`coveredBottom`).
- **THE RATE PATTERNS read the edges' own verdicts** (`canvasInsights`,
  user-confirmed definitions): LOSING EVERYWHERE = Bad in ≥ 2 campaigns,
  Good/Decent in none, N/A ignored; LEANS ON ONE = a campaign with 2+
  creatives (`totalChildren`) where one took ≥ 70% (`LEAN_SHARE`) of its TRUE
  range spend; UNSCALED WINNER = one campaign, that pairing Good AND live.
  The strip and the MCP's `get_canvas_patterns` are the SAME function — never
  a second copy of a definition.
- **THE LEVEL FOLDS THE SAME SCAN (2026-11-24).** `?level=campaign` draws
  CAMPAIGNS (`parent_campaigns`, node id `p:<uuid>`) on the campaign side; ad
  sets are the default and the clean URL (user decision — old links keep
  their meaning). The scan never changes: one row per (ad set, creative),
  LEFT JOINed to its campaign; `canvasPairs` folds it to (campaign, creative)
  BEFORE totals, health and the cap, so every rule above holds at both
  levels. A folded pairing is judged by `pairVerdict` PER PLATFORM: live when
  live on ANY of its platforms (each against its own latest spend day — the
  window clock is per platform, never merged); Rate by that platform's rules
  when it ran on one, the brand default when on two (Summary's scope rule);
  the line takes the colour of the platform that spent most, and its tooltip
  names both. A campaign is active when ANY registered ad set is — one
  registry read, never a status scan. The level is a SERVER param (a
  navigation), unlike `?view=` / `?lens=`. The patterns' definitions are the
  same function at both levels; only the word changes (`canvasLevelNoun`).
- **`?focus=` IS THE INSPECTED NODE, AND ONLY THAT.** The URL carries the node
  the inspector is open on (`k:<uuid>` creative / `c:<uuid>` ad set /
  `p:<uuid>` campaign — an id, so a rename never breaks a link), parsed by ONE
  `parseCanvasFocus` for server and client. A link naming only a campaign's
  node is a campaign-level link (`focusLevel`); a node drawn at the OTHER
  level is said so, never blamed on the range. A chip's group focus never enters the link (it's
  recomputed from the range). Written by shallow REPLACE like `?view=` /
  `?lens=` — node clicks add no Back steps. A linked node that isn't drawn is
  SAID (a notice naming it, brand-scoped `canvasFocusName`), never silently
  dropped; an id from another brand reads as unknown, never as its name.
- **LAUNCHED = first-ever real spend inside the range**, for creatives and
  campaigns (`launchedOn`). Judged under the canvas's platform filter and
  Excluded toggle — the facts it draws — but NEVER its creative filters
  (product, stage), which must not make an old campaign read as launched.
  The tag says "Launched", never "New" (that word is the never-spent creative
  status). The chip and the MCP's `launched` pattern are the same function.
- **BY ANGLE: clusters are angles, chips are WHOLE creatives** (`?view=angle`).
  A creative with several angles is a chip in each, so angle headers overlap
  and never add up to the brand total (the header's tooltip and the legend
  say so). A chip's spend / ROAS / Rate are the creative's own over all its
  campaigns (`creativeRate`: Summary's scope — one platform filtered → its
  rules, else the brand default); `live` = spending in ANY campaign now. An
  angle header (`a:<name>`, `a:` = "No angle") is not an entity: a click
  lights its cluster and opens nothing, and it never enters `?focus=`.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Canvas

<!-- was CLAUDE.md L2055–2221 -->

- **CANVAS (`/canvas`, 2026-09, phases C1 + C1.5 + C2) — the campaign↔creative
  graph. READ-ONLY FACTS.** Ads section, between Campaigns and Trends. An edge exists
  because a creative SPENT (> 0) inside a campaign in the selected range, under
  the resolved Excluded toggle; nothing on the page is ever edited and every
  control is a VIEWING tool. Nodes are NOT draggable, connectable or selectable
  (React Flow makes that a first-class prop — it isn't awkward), and no
  position is ever saved: these are facts, not a whiteboard.
  - **The dependency:** `@xyflow/react` `12.11.6`, exact-pinned, user-approved
    (see Stack for the justification line). ONE importer
    (`components/canvas/canvas-flow.tsx`), loaded via `next/dynamic` +
    `ssr: false` from `canvas-view.tsx`. Verified in the build: React Flow is a
    single lazy chunk (~57 kB gz + ~2.6 kB gz CSS) referenced only by
    `/canvas`'s loadable manifest — it is in NO route's first load, `/canvas`
    included, and the shared first-load JS did not move. Keep it that way: do
    not import `@xyflow/react` from a second module.
  - **Data — `canvasGraph()` (`db/queries/canvas.ts`).** ONE aggregation scan
    builds every edge and both node sets (`max: 1` discipline); statuses derive
    from the cached status inputs (never another status scan). **"Active but
    idle" creatives** — live by status, no edge in the range — are included as
    unconnected nodes so their insight chip has something to focus; they cost
    one PK lookup on `creatives`, and only when there are any. **Node totals
    are the entity's TRUE range spend under the SQL-level filters** — the
    status filter and the scale cap only HIDE things, they never restate a
    number, so "42% of this campaign's spend" stays honest whatever is shown.
    With a platform filter, a creative's status is the roll-up over the
    SELECTED platforms (the Library's rule), or a TikTok-only creative would
    read "active but idle" on an Instagram canvas when it is merely filtered
    out. The range is resolved server-side (`resolvePreferredRange` → last 30
    days); creative statuses default to everything but Terminated. **Google is
    ordinary data here** — the canvas is about who spent where, which google
    reports like everyone else, so its filter offers `ALL_PLATFORMS`.
  - **TWO CLOCKS, LOCKED (user-confirmed — do not merge them).**
    (1) The **RANGE** (date picker) decides whether an edge EXISTS: any spend
    for the (campaign, creative) pair inside it draws the edge. (2) The
    **STATUS WINDOW** decides whether that edge is **LIVE** — the pair's last
    spend day within `accounts.status_window_hours` of the campaign's
    platform's OWN latest spend day. That is the system's one freshness rule
    applied to a pair: `edgeIsLive` IS `deriveCampaignStatus`, not a copy.
    **LIVE** draws solid, full platform color; **PAUSED HERE** (spent in the
    range, not in the window) draws dashed at ~45%. The query serves both from
    ONE scan: it is bounded BELOW by the range start only, the in-range sums
    are `scopedMetrics`-FILTERed to `date <= to`, and the pair's last
    real-spend day is read from the same rows UNCLIPPED — because "live" means
    spending NOW, so an old range whose pair still runs today reads live, and
    "paused here since <date>" never names a date the pair spent past. `HAVING`
    in-range spend > 0 keeps existence on the range clock (later spend alone
    draws nothing). Liveness is judged in JS against the cached
    `platformSpendFreshness()` — no second scan.
  - **Layout — TRIPARTITE, by hand, NO layout engine** (`lib/canvas.ts`, pure,
    unit-tested; a user decision). Campaigns in the CENTER by spend desc;
    creatives flank them BY TYPE — **video RIGHT, everything else LEFT**
    (`creativeSide`). The BARYCENTER heuristic (average row of the campaigns
    feeding each creative) runs PER SIDE against the center so edges cross
    less; ties by spend then name for a stable order; idle creatives sit at the
    bottom of their own type's side. Edges route left → center and center →
    right (a left-flank creative is the React Flow SOURCE), the left flank is
    right-aligned and the right flank left-aligned, so every edge leaves from
    the side facing the center however wide its node is. Edge width =
    sqrt(spend) inside a min/max, colored by the CAMPAIGN's platform var.
  - **Node visuals (all user-approved).** **STATUS BORDER is the headline
    signal** — 2px in the status color (`STATUS_DOT` / `CAMPAIGN_STATUS_DOT`),
    measured ≥ 3.37:1 against both the node surface and the canvas on all four
    themes. The status WORD rides inside too; the old inner dot is gone — a
    second color-coded mark tells a colorblind reader nothing the border hadn't
    already failed to. **SIZE BY SPEND**: `nodeScale` = sqrt(spend) against the
    biggest node OF THE SAME KIND (campaign totals dwarf creative ones), within
    0.85–1.45; the body is laid out once at the base size and scaled whole, so
    box and type grow together; sizes feed the layout's spacing (each column
    stacks by its nodes' own heights) so rows never collide. **CAMPAIGN HEALTH
    "3/5"** = creatives with a LIVE edge to this campaign / creatives that
    spent there in the range (`campaignHealth`, from edge liveness — one
    source), counted over EVERY scanned edge, so like the totals it is a fact
    the status filter and the scale cap can't restate. **HOVER PRE-FOCUS**: a
    lighter preview of click-focus — the node's edges go full strength and the
    rest dims only to 70%; an active click-focus always wins (the hover id is
    ignored while one is set).
  - **The legend is non-optional**: bottom-left, collapsed to a "?" chip by
    default, remembered per browser (`cw-canvas-legend`). It states every
    encoding — border = status, solid vs dashed = live vs paused here, size and
    line weight = spend, line color = platform. The four corners each have one
    job: search · zoom · legend · minimap; nothing covers React Flow's
    attribution.
  - **Nodes have KNOWN dimensions AND carry `measured`.** The node list is
    rebuilt on every focus/hover change and culled off-screen
    (`onlyRenderVisibleElements`), so React Flow would otherwise have no
    measured size for most nodes — and `fitView({ nodes })` silently IGNORES a
    node without one (the minimap was empty and an insight chip snapped the
    viewport to identity). Supplying `width`/`height`/`measured` from the
    layout boxes fixes both. **The flip side, caught in C1.5: the INITIAL fit is
    done by hand.** With `measured` supplied, React Flow's own `fitView` prop
    resolves the instant nodes exist — BEFORE the pane has been measured (store
    width 0) — and frames the graph against nothing; C1 shipped under-zoomed on
    desktop because of it. `canvas-flow.tsx` fits in an effect gated on the
    store's pane size, and again whenever the graph changes. Don't restore the
    `fitView` prop.
  - **Focus** = the primary node(s), every edge touching one, and the
    neighbours at the other end (`focusFor`); everything else dims to 15%.
    Click a node, pick a search result, or click an insight chip (those two
    also pan/zoom to the subgraph); empty-canvas click or Esc clears.
    Double-click opens the entity's detail page.
  - **The insights strip TELLS you the patterns** (`canvasInsights`, pure,
    computed from the same graph the canvas draws so a chip can never point at
    a missing node): **campaigns with no live creatives** (every edge into them
    is paused here — the health count reads 0/N; defined on edge liveness, the
    same source as the health count, which superseded C1's child-general-status
    rule) · active creatives idle in the range · the most-shared creative (≥ 2
    campaigns; ties to the bigger spender). Zero-case chips are absent.
  - **Scale cap: ~400 nodes / ~800 edges** (`capEdges`) — keep the TOP edges by
    spend and SAY SO ("showing the top N of M connections by spend"); idle
    creatives that don't fit the node budget are counted in the same note.
    Never a hairball, never a silent truncation.
  - **Theming:** React Flow's chrome is re-pointed at the app's tokens through
    its `--xy-*` CSS variables (canvas = `--background`, minimap/controls =
    `--surface`, edges via the platform vars), so all four themes hold. The
    top-bar screenshot button captures the canvas faithfully — React Flow
    renders DOM + SVG, and `modern-screenshot` handles both (verified).
  - **C2 (DONE, 2026-09): the VIEW SWITCHER — Network · By campaign · By
    creative.** Same data, same filters, same clocks: `canvasGraph()` is
    untouched and every view is a PURE function over what it returns
    (`buildClusters` → `clusterBoxes` → `clusterFocus` in `lib/canvas.ts`). No
    migration, no dependency.
    - **`?view=` is URL-backed and validated** (`parseCanvasView`, derived from
      `CANVAS_VIEWS`; anything unknown is the network, which is also the clean
      URL). Deliberate: the comments system snapshots the query string, so a
      comment reproduces the exact view. Switching is a re-layout of data
      already on the client — `window.history.replaceState` (Next syncs
      `useSearchParams`), NO server round-trip; the filter bar's own
      `router.replace` carries the param along untouched.
    - **THE CHIP CARRIES THE PAIRING.** In a cluster view an entity is drawn
      once PER PAIRING (a creative in five campaigns appears five times — that
      is the tree, embrace it), so the chip stands for the EDGE, not the
      entity: **dashed + dimmed chip ≡ the network's dashed line** (paused
      here), solid chip ≡ live here, and the border COLOR is still the entity's
      own status. Liveness is the edge's `live` flag — one source
      (`edgeIsLive`), never re-derived for chips. The legend says this in one
      extra block, cluster views only; the chip tooltip is the EDGE's tooltip.
      A paused chip dims by PARTS (hollow fill + ink-2 name), not by opacity:
      a flat 0.6 measured 2.9:1 on Frost/Paper and any wrapper opacity drags
      the dashed status border under 3:1 there.
    - **Layout:** plain computed positions, NOT React Flow parent/group nodes
      — nothing drags, and sub-flows would complicate `measured`, culling and
      fitView for no gain. A cluster = a quiet frame (`pointer-events: none`,
      so an empty click inside it still clears focus) + the header (the SAME
      campaign/creative node component, same spend-scaled size) + a 2-column
      chip grid: live chips first, then paused, each by spend desc. Clusters
      wrap in rows by header spend desc; the column count follows the PANE
      (`clusterColumnsFor` — one column on a phone). By campaign: idle-active
      creatives form one trailing "Idle creatives" pseudo-cluster. By creative:
      campaign chips are lean (platform dot + name + pairing spend, no health
      count) and idle-active creatives are chipless headers, last.
    - **Focus is held in ENTITY ids**, never occurrence ids — so clicking a
      chip or header lights EVERY occurrence (each with its frame + header for
      context), a header lights its whole cluster, and a view switch mid-focus
      **RE-MAPS** the focus rather than clearing it. `CanvasFocusRequest.fit` is
      `"none"` (click) · `"all"` (insight chips) · `"first"` (search — pans to
      the first occurrence, focuses all). The three insights are unchanged;
      "most shared" is best in By campaign (its chip's `title` says so).
    - **Fit per view:** the network frames the whole graph; a cluster view
      frames its top two rows (spend desc — fitting a tall board whole would
      shrink every chip to nothing). **Cap:** `CANVAS_MAX_CHIPS` (500) by the
      same top-spend rule (`capEdges`), idle chips filling what room remains,
      with the same quiet note.
    - **Rig gotcha:** when the Browser pane is HIDDEN, rAF, CSS transitions and
      ResizeObserver all stall — computed opacities read one step stale, fit
      animations never finish, and edges count 0 until a screenshot forces a
      paint. Read inline styles, and shim rAF onto a timer in the rig's HTML.

### Performance lens (2026-11-20)

- **C3: the PERFORMANCE LENS — "Colour: Platform · Rate".** The Canvas told
  you who spent where but not how well: `canvasGraph()` already summed each
  pair's conversions and revenue, then dropped them on the edge. The lens
  carries `roas` + `rate` on every `CanvasEdge` (and its cluster chips) and
  recolours by RATE. No new scan, no migration: the cached `getRatingConfig()`
  joins the query's existing `Promise.all`.
  - **User decisions (all four recommendations taken):** reuse Rate — the
    admin-defined Good / Decent / Bad / N/A, so "Good" on the Canvas means
    exactly what it means in the Summary's Rate column (a continuous ROAS
    gradient was declined; CPA was dropped, no CPA thresholds exist) · the
    SAME min spend, per PAIRING — a short range honestly reads mostly N/A
    (a one-day range on local data: every line grey) · the switch sits beside
    the view switcher, URL-backed `?lens=rate` (a comment's captured query
    string reproduces it; a fresh visit is Platform, the clean URL) · in the
    cluster views a paired chip gets a left Rate stripe and shows the pairing's
    ROAS in place of its spend — an N/A chip keeps its spend.
  - **Scope of the rules = the CAMPAIGN's platform** — the line was already
    coloured by it, and a pairing lives on exactly one platform.
  - **Tooltips** (line and chip) show "ROAS 3.2× · ● Good" in BOTH lenses; the
    swatch carries the colour, the word carries the meaning.
  - **Legend:** in the Rate lens, a 2-column block with the brand DEFAULT
    thresholds as typed (`9×`, never `9.00×` — the long form made the column
    scroll sideways) and where overrides live (Configuration › Rate rules).
    The legend is now capped to the pane height and scrolls: with the Rate
    block it slid under the search box.
  - **Contrast (measured in the app, four themes):** at the network's 0.85 live
    opacity, Good / Decent / N/A measured 2.7–3.0:1 on Frost and Paper; at full
    opacity every Rate token clears 3.4:1 everywhere, so a live Rate line draws
    at 1 (paused lines keep their deliberate dashed 0.45). *Not fixed, found
    in passing:* the PLATFORM lens's Facebook (2.4:1) and Snapchat (2.3:1)
    lines are under 3:1 on Frost and Paper — that predates this change.

### Click inspector (2026-11-20)

- **C4: the CLICK INSPECTOR.** A click used to only focus; the numbers lived in
  a hover tooltip or on the entity's page. Now a single click (also a search
  pick or a pairing row) opens a read-only panel: header (name, status,
  stars / "3/5 live"), four `MetricCard` tiles (Spend · ROAS · Conversions ·
  CPA, from the node's range sums), the pairings (live first, then spend
  desc — the chips' order — each with live / "paused since", share of the
  inspected node's spend, spend, and ROAS + Rate dot from the edge), "Open
  creative/campaign →", and a line when filters hid pairings (a campaign's
  `totalChildren` makes the count exact; a creative's list says "may be
  partial" only when the cap bit). Pure model `inspectFor` in `lib/canvas.ts`.
  - **User decisions (all four recommendations taken):** a non-modal column
    beside the canvas (the house `Sheet` was declined: it is modal, so you
    couldn't click another node with it open) · single click opens it, Esc /
    empty click / ✕ close it with the focus, double-click still opens the
    page, insight chips (group focus) don't open it · a pairing row inspects
    that entity and pans to it · Spend, ROAS, Conversions, CPA.
  - **`CanvasFocusRequest.inspect`** carries the "open the panel" intent, so
    the panel follows the focus through view switches for free.
  - **Two seams the walk caught:** (1) the column narrows the pane from the
    right, so a node clicked near that edge vanished behind the panel it had
    opened — a keep-in-view effect pans (same zoom, only when out of view) to
    the first lit occurrence; on a phone it centres the node in the strip
    above the overlay (`coveredBottom`). (2) In the overlay, two rows of
    headline-size tiles pushed the pairings below the fold — one row of four
    on a phone, 2×2 in the desktop column.
  - **Cluster views** count their columns as if the inspector weren't there
    (`reservedWidth`), so opening it never re-flows or re-fits the board.
  - The hint under the canvas reads "click for details" (was "click to
    focus"). *Found, not fixed:* at ~1000px that hint wraps to two lines and
    the page scrolls ~45px, because the frame reserves 1.5rem below itself —
    true before this change too.
  - **Rig note:** the Browser pane's `preview_start` ran the dev server in the
    MAIN checkout, not the session's worktree — it served `main`'s code. Check
    the server's cwd (`lsof -p <pid> -d cwd`) before trusting a worktree walk.

### Pattern alerts (2026-11-20)

- **C5: three Rate patterns in the insight strip, and the strip on the MCP.**
  With every pairing carrying its Rate (C3), the strip now names what a media
  buyer acts on: "N creative(s) losing everywhere" · "N campaign(s) lean(s)
  on one creative" · "N winner(s) in one campaign only". Order: no live
  creatives · idle actives · losing · leaning · winners · most shared — the
  problems first, the existing chips in their places. Each chip's tooltip
  states its rule; a click focuses the creatives (losing, winners) or the
  campaigns (leaning), and never opens the inspector (group focus).
  - **User decisions (all four recommendations taken):** a winner must be
    Good AND live (a paused Good pairing was likely stopped on purpose) and in
    ONE campaign · leaning is ≥ 70% with 2+ creatives (a one-creative
    campaign is 100% by construction — it would flood the chip) · losing is
    Bad in 2+ and better nowhere, N/A ignored · the MCP reads it: new
    read-only `get_canvas_patterns`.
  - **The share is against the campaign's TRUE range spend**, like every
    Canvas total, so a filter that hides a creative can't manufacture a
    "leans on one" (unit-tested: a campaign whose other $300 was filtered out
    of the drawing still reads 70%, not 100%).
  - **`get_canvas_patterns`** runs `canvasGraph` (statuses = the Canvas
    default, all but Terminated) + `canvasInsights` and details each entity
    through `inspectFor`: losing → its Bad pairings; leaning → the top
    creative and its share; winner → its campaign; most shared → its
    campaigns; each pairing with spend, ROAS, rate, live, last spend day.
    `lib/mcp/coverage.ts` lists `canvas` under it; `tests/db/mcp.test.ts`
    pins it (most shared with excluded hidden, leaning 83% with them in).

### Focus in the link (2026-11-20)

- **C6: `?focus=` — a shared or reloaded Canvas opens on the same node.**
  Focus lived in component state, so a reload, a shared URL or a comment's
  captured query string lost it. Now the inspected node is in the URL and the
  page opens on it: lit, panned to (in any view), inspector open.
  - **User decisions (all four recommendations taken):** the link holds the
    INSPECTED node only (not a chip's focus) · the creative and campaign
    detail pages get an "On the Canvas" link (beside "Compare…" in the
    Analytics row — that row is where the page's range lives, and the link
    carries that range, like Compare; from `lg` both moved to the entity
    rail as icons on 2026-11-21, still carrying the range — see
    comments-notifications.md) · a linked node that isn't drawn gets a
    one-line notice with Clear, the canvas draws as normal beneath · focus
    REPLACES the URL, so Back leaves the Canvas.
  - **Resolved on the server**: the page validates `?focus=` through
    `canvasFiltersSchema`, checks it against the drawn graph, and only when it
    isn't drawn looks up its name (one brand-scoped query). The client follows
    a new answer after a filter or range change (a node that drops out gets
    the notice; one that appears opens) — the filter bars carry `focus` along
    like any param. An empty graph shows the page's empty state instead (it
    already says nothing spent).
  - **Found in the walk, fixed:** a "first occurrence" pan (search picks,
    pairing rows, and now links) centred the node in the WHOLE pane — under
    the phone's inspector overlay. It now runs the keep-in-view step once the
    pan lands, so the node sits in the visible strip above the overlay.
  - MCP: not relevant — `?focus=` is presentation state; the data it points at
    is already on `get_canvas_patterns` / `get_creative` / `get_campaign`.

### Launched this range (2026-11-20)

- **C7: a "Launched" tag on creatives and campaigns whose first-ever real
  spend falls in the range**, a "N launched this range" chip that lights
  them, the first-spend date in the inspector header, and a `launched`
  pattern on `get_canvas_patterns` (with `first_spend_day`).
  - **User decisions (all recommendations taken):** creatives and campaigns,
    not pairings (an old creative newly put in a campaign is not marked) · a
    "Launched" tag, because "New" already means never-spent · the chip · on
    the MCP inside the existing patterns tool.
  - **How it's computed:** the graph scan already starts at the range's first
    day; it now also takes each pair's first real-spend day in the range, and
    two parallel `SELECT DISTINCT` lookups (creative ids, campaign ids) find
    who had real spend BEFORE the range — `perf_account_date_idx` covers the
    `date < from` scan. A node's first in-range day survives only if it isn't
    in that set. Idle creatives never launch (no spend in the range).
  - **Placement:** informational, so the chip sits after the problem chips
    (no live · idle · losing · leaning · winners · launched · most shared).

### By angle (2026-11-20)

- **C8: a fourth view, "By angle".** One cluster per angle (spend desc), its
  creatives as chips; "No angle" trails the angles, idle-active creatives keep
  their own trailing cluster. The header shows the angle's spend, ROAS (sums
  over its creatives) and "n/m live".
  - **User decisions (all recommendations taken):** chips are creatives, not
    pairings · the header shows spend · ROAS · live count, with the overlap
    explained · a trailing "No angle" cluster · a header click lights its
    creatives, no details panel.
  - **Data:** the graph's creatives now carry `angles` (one query on
    `creative_angles` for the creatives drawn — no `account_id` there, so the
    brand-scoped scan's ids bound it) and their own `roas` / `rate`.
  - **Judgment calls:** the two campaign-only insight chips (no live
    creatives, leans on one) are hidden in this view — it draws no campaigns,
    so they would light nothing; "Launched" there lights only the creatives
    and its tooltip says so. Switching away from By angle drops an angle
    header's focus. The chip cap (500) keeps the top creative-angle
    occurrences by spend and says so.
  - MCP: not relevant — `get_trends` already returns per-angle performance
    (`angleRollup`); this view is a re-layout of the same graph.

### Campaign level (2026-11-24)

- **C9: `Show: Campaigns · Ad sets` — the campaign side at either level.**
  Delivery 2 of the campaign / ad set split (`campaigns.md`). The Canvas drew
  one node per ad set — 191 on Urjwan — when the user thinks in 76 campaigns.
  - **User decision:** the Canvas OPENS ON AD SETS (the recommendation): every
    shared link, every comment's captured query string and every "On the
    Canvas" button keeps meaning what it meant; campaigns is one click, kept
    in the link (`?level=campaign`).
  - **How:** `canvasGraph({ level })`. The scan is untouched save a LEFT JOIN
    to `parent_campaigns`; the pure `canvasPairs` folds (ad set, creative)
    rows to (campaign, creative) pairings — summed, the per-platform slices
    kept apart — and the loop that builds nodes, health and edges runs over
    pairings at both levels. `pairVerdict` is the one place a pairing gets
    its two clocks and its Rate. At campaign level the "spent before the
    range" lookup reads `campaigns.parent_id` (a campaign launched only if
    none of its ad sets had spent), and one registry read gives each campaign
    its ad sets (status = any active; the count on the node).
  - **A Meta campaign runs on two platforms**, which the ad-set Canvas never
    had to answer. Decided with the user in the plan: the line takes the
    colour of the platform that spent most in the pairing and the tooltip
    names both ("Instagram + Facebook"); the pairing is live when it is live
    on either, each against its own platform's latest spend day; its Rate uses
    that platform's rules when it ran on one, the brand default when on two.
  - **The node** shows the campaign's name and "Meta · N ad sets" (its
    network and the registry count; its objectives in the tooltip — a
    campaign may carry several) where an ad set shows its objective, and the
    same status word, health and spend. The network is what tells two
    same-named campaigns apart (a name is unique only per network) — the walk
    found them distinguishable by a dot's colour alone — so the search rows
    and the inspector (header and pairings) say it too. "Open campaign" and a
    double-click go to the campaign page. The second view reads "By campaign".
  - **Focus across a switch:** an inspected AD SET follows up to its
    campaign, an inspected creative stays (it is drawn at both levels), a
    campaign has no one ad set to land on and clears; a chip's group focus is
    dropped with the level (its node ids are gone). A `?focus=` drawn at the
    other level says so — "is an ad set — switch Show to Ad sets" — instead
    of blaming the range.
  - **Found in passing, fixed:** the missing-node notice printed the code's
    word ("The linked campaign isn't in this brand") for an AD SET; it now
    reads the UI's word for each kind (`CANVAS_FOCUS_NOUN`).
  - MCP: `get_canvas_patterns` takes `level` (default `ad_set`); a campaign
    item carries `network` and `ad_sets`. Same functions, no second copy.
  - Tests: `lib/canvas-level.test.ts` (the fold, the verdicts, the words) and
    `tests/db/campaign-level.test.ts` (true totals, liveness on a real Meta
    campaign, launched, tenancy).
