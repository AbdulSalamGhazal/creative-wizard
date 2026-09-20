/**
 * Canvas — the campaign↔creative graph. Everything here is PURE (no DB, no
 * React, no layout engine) so the layout, the insights and the scale cap are
 * unit-tested rather than eyeballed on a canvas.
 *
 * READ-ONLY FACTS: an edge exists because a creative SPENT inside a campaign
 * in the selected range. Nothing on the Canvas page is editable — nodes aren't
 * a whiteboard, and no position is ever saved.
 */
import type { CreativeStatus } from "@/lib/creative-status";
import { deriveCampaignStatus, type CampaignStatus } from "@/lib/campaign-status";

export type CanvasCreativeType = "video" | "image" | "slides";

export interface CanvasCampaignNode {
  kind: "campaign";
  /** Graph id — prefixed so a campaign and a creative can never collide. */
  id: string;
  campaignId: string;
  name: string;
  objective: string;
  platform: string;
  status: CampaignStatus;
  spend: number;
  conversions: number;
  revenue: number;
  /**
   * HEALTH: creatives with a LIVE edge to this campaign / creatives that spent
   * here in the range. Counted over every scanned edge — like the totals, it
   * is a fact about the campaign, not about what the filters leave visible.
   */
  liveChildren: number;
  totalChildren: number;
}

export interface CanvasCreativeNode {
  kind: "creative";
  id: string;
  creativeId: string;
  name: string;
  type: CanvasCreativeType;
  status: CreativeStatus;
  priority: number | null;
  stages: string[];
  thumbnailUrl: string | null;
  spend: number;
  conversions: number;
  revenue: number;
}

export type CanvasNode = CanvasCampaignNode | CanvasCreativeNode;

export interface CanvasEdge {
  id: string;
  /** Campaign node id. */
  source: string;
  /** Creative node id. */
  target: string;
  /** The CAMPAIGN's platform — what the edge is colored by. */
  platform: string;
  spend: number;
  /** The pair's last real-spend day (spend > 0), NOT clipped to the range. */
  lastSpendDay: string | null;
  /** The second clock — see {@link edgeIsLive}. */
  live: boolean;
}

// ── Two clocks ───────────────────────────────────────────────────────────────

/**
 * THE TWO CLOCKS (user-confirmed; do not merge them):
 *
 *  1. The RANGE decides whether an edge EXISTS — any spend for the
 *     (campaign, creative) pair inside the picked dates draws it.
 *  2. The STATUS WINDOW decides whether that edge is LIVE — the pair's last
 *     spend day falls within the brand's window of the campaign's platform's
 *     OWN latest spend day. This is the system's one freshness rule, applied
 *     to a pair: it is `deriveCampaignStatus`, not a copy of it.
 *
 * A LIVE edge draws solid; a PAUSED-HERE edge (spent in the range, not in the
 * window) draws dashed and dimmed. The last spend day is deliberately NOT
 * clipped to the range: "live" means spending NOW, so an old range whose pair
 * is still running today reads live, and "paused here since <date>" never
 * names a date the pair actually spent past.
 */
export function edgeIsLive(input: {
  lastSpendDay: string | null;
  platformLatestDay: string | null;
  windowDays: number;
}): boolean {
  return deriveCampaignStatus(input) === "active";
}

export interface CanvasGraph {
  campaigns: CanvasCampaignNode[];
  creatives: CanvasCreativeNode[];
  edges: CanvasEdge[];
  /** Set when the scale cap trimmed the graph — the page SAYS so. */
  truncated: {
    shownEdges: number;
    totalEdges: number;
    /** Active-but-idle creatives that didn't fit the node budget. */
    idleHidden: number;
  } | null;
}

export const campaignNodeId = (id: string) => `c:${id}`;
export const creativeNodeId = (id: string) => `k:${id}`;

// ── Campaign health ─────────────────────────────────────────────────────────

/**
 * Per campaign: how many of its in-range creatives have a LIVE edge to it.
 * Derived from edge liveness — the ONE source the health count, the dashed
 * edges and the "no live creatives" insight all read.
 */
export function campaignHealth(
  edges: ReadonlyArray<Pick<CanvasEdge, "source" | "live">>,
): Map<string, { live: number; total: number }> {
  const out = new Map<string, { live: number; total: number }>();
  for (const e of edges) {
    const h = out.get(e.source) ?? { live: 0, total: 0 };
    h.total += 1;
    if (e.live) h.live += 1;
    out.set(e.source, h);
  }
  return out;
}

// ── Scale cap ────────────────────────────────────────────────────────────────

/** Past this the canvas is a hairball, not a picture. */
export const CANVAS_MAX_NODES = 400;
export const CANVAS_MAX_EDGES = 800;

/**
 * Keep the TOP edges by spend until either cap would be exceeded. Returns the
 * kept edges (spend desc) and the original count, so the page can say "showing
 * the top N connections by spend" — never a silent truncation. An edge that
 * would push the NODE count past its cap is skipped, but a later (smaller)
 * edge between two already-kept nodes still fits, so the walk continues.
 */
export function capEdges<E extends { source: string; target: string; spend: number }>(
  edges: readonly E[],
  maxNodes: number = CANVAS_MAX_NODES,
  maxEdges: number = CANVAS_MAX_EDGES,
): { kept: E[]; total: number; truncated: boolean } {
  const sorted = [...edges].sort((a, b) => b.spend - a.spend);
  const nodes = new Set<string>();
  const kept: E[] = [];
  for (const e of sorted) {
    if (kept.length >= maxEdges) break;
    const added = (nodes.has(e.source) ? 0 : 1) + (nodes.has(e.target) ? 0 : 1);
    if (nodes.size + added > maxNodes) continue;
    nodes.add(e.source);
    nodes.add(e.target);
    kept.push(e);
  }
  return { kept, total: edges.length, truncated: kept.length < edges.length };
}

// ── Layout ───────────────────────────────────────────────────────────────────

/** Base node box; the drawn box is this × {@link nodeScale}. */
export const CANVAS_NODE_WIDTH = 232;
export const CANVAS_NODE_HEIGHT = 56;
export const NODE_MIN_SCALE = 0.85;
export const NODE_MAX_SCALE = 1.45;
export const CANVAS_ROW_GAP = 20;
export const CANVAS_COLUMN_GAP = 380;

/**
 * NODE SIZE BY SPEND: sqrt(spend) against the biggest node OF THE SAME KIND
 * (campaign totals dwarf creative ones, so a shared scale would pin every
 * creative at the minimum), inside sane bounds. A zero-spend (idle) node is
 * the minimum. The whole node scales — box and type — so size reads as one
 * signal.
 */
export function nodeScale(spend: number, maxSpend: number): number {
  if (!(maxSpend > 0) || !(spend > 0)) return NODE_MIN_SCALE;
  const t = Math.min(1, Math.sqrt(spend) / Math.sqrt(maxSpend));
  return NODE_MIN_SCALE + (NODE_MAX_SCALE - NODE_MIN_SCALE) * t;
}

/** Which flank a creative sits on: VIDEO right, everything else left. */
export type CanvasSide = "left" | "right";
export function creativeSide(type: CanvasCreativeType): CanvasSide {
  return type === "video" ? "right" : "left";
}

/**
 * Column ORDER for the tripartite layout — no layout engine:
 *  - CENTER: campaigns by spend desc (the biggest story on top);
 *  - each FLANK: that side's creatives by the BARYCENTER heuristic — the
 *    average row index of the campaigns each one connects to — so a creative
 *    sits level with what feeds it and edges cross less. Ties break by spend
 *    desc, then name, so the order is stable run to run. Unconnected creatives
 *    (the "active but idle" ones) have no barycenter and go to the BOTTOM of
 *    their type's side, by name.
 */
export function tripartiteOrder(graph: Pick<CanvasGraph, "campaigns" | "creatives" | "edges">): {
  left: string[];
  center: string[];
  right: string[];
} {
  const center = [...graph.campaigns]
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
    .map((c) => c.id);
  const rowOf = new Map(center.map((id, i) => [id, i]));

  const sums = new Map<string, { total: number; n: number }>();
  for (const e of graph.edges) {
    const row = rowOf.get(e.source);
    if (row === undefined) continue;
    const s = sums.get(e.target) ?? { total: 0, n: 0 };
    s.total += row;
    s.n += 1;
    sums.set(e.target, s);
  }
  const bary = (id: string): number | null => {
    const s = sums.get(id);
    return s && s.n > 0 ? s.total / s.n : null;
  };
  const byBarycenter = (a: CanvasCreativeNode, b: CanvasCreativeNode) => {
    const ba = bary(a.id);
    const bb = bary(b.id);
    if (ba === null && bb === null) return a.name.localeCompare(b.name);
    if (ba === null) return 1;
    if (bb === null) return -1;
    return ba - bb || b.spend - a.spend || a.name.localeCompare(b.name);
  };
  const flank = (side: CanvasSide) =>
    graph.creatives
      .filter((c) => creativeSide(c.type) === side)
      .sort(byBarycenter)
      .map((c) => c.id);

  return { left: flank("left"), center, right: flank("right") };
}

/**
 * Every node's spend-scaled size — ONE function, so a campaign is drawn the
 * same size as a network node and as a cluster header.
 */
export function canvasNodeSizes(
  graph: Pick<CanvasGraph, "campaigns" | "creatives">,
): (id: string) => { width: number; height: number } {
  const maxCampaign = graph.campaigns.reduce((m, c) => Math.max(m, c.spend), 0);
  const maxCreative = graph.creatives.reduce((m, c) => Math.max(m, c.spend), 0);
  const scale = new Map<string, number>();
  for (const c of graph.campaigns) scale.set(c.id, nodeScale(c.spend, maxCampaign));
  for (const c of graph.creatives) scale.set(c.id, nodeScale(c.spend, maxCreative));
  return (id) => {
    const k = scale.get(id) ?? NODE_MIN_SCALE;
    return { width: CANVAS_NODE_WIDTH * k, height: CANVAS_NODE_HEIGHT * k };
  };
}

export interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Concrete boxes from the order. Sizes feed the spacing — each column stacks
 * by its nodes' OWN heights plus a gap, so a big node never collides with its
 * neighbour — and the shorter columns are centered against the tallest. The
 * left flank is right-aligned and the right flank left-aligned, so every edge
 * leaves from the side facing the center however wide its node is.
 */
export function tripartiteBoxes(
  graph: Pick<CanvasGraph, "campaigns" | "creatives" | "edges">,
): Map<string, CanvasBox> {
  const order = tripartiteOrder(graph);
  const size = canvasNodeSizes(graph);
  const columnHeight = (ids: string[]) =>
    ids.reduce((h, id) => h + size(id).height, 0) +
    Math.max(0, ids.length - 1) * CANVAS_ROW_GAP;

  const widest = CANVAS_NODE_WIDTH * NODE_MAX_SCALE;
  const centerX = widest + CANVAS_COLUMN_GAP + widest / 2; // the center column's axis
  const rightX = centerX + widest / 2 + CANVAS_COLUMN_GAP;
  const tallest = Math.max(
    columnHeight(order.left),
    columnHeight(order.center),
    columnHeight(order.right),
  );

  const out = new Map<string, CanvasBox>();
  const place = (ids: string[], xOf: (width: number) => number) => {
    let y = (tallest - columnHeight(ids)) / 2;
    for (const id of ids) {
      const { width, height } = size(id);
      out.set(id, { x: xOf(width), y, width, height });
      y += height + CANVAS_ROW_GAP;
    }
  };
  place(order.left, (w) => widest - w); // right-aligned to the gap
  place(order.center, (w) => centerX - w / 2); // centered on the axis
  place(order.right, () => rightX); // left-aligned to the gap
  return out;
}

// ── Edge weight ──────────────────────────────────────────────────────────────

export const EDGE_MIN_WIDTH = 1;
export const EDGE_MAX_WIDTH = 8;

/** Stroke width by sqrt(spend) against the graph's biggest edge — sqrt so one
 *  whale doesn't flatten everything else to a hairline. */
export function edgeWidth(spend: number, maxSpend: number): number {
  if (!(maxSpend > 0) || !(spend > 0)) return EDGE_MIN_WIDTH;
  const t = Math.sqrt(spend) / Math.sqrt(maxSpend);
  return EDGE_MIN_WIDTH + (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH) * Math.min(1, t);
}

// ── Focus ────────────────────────────────────────────────────────────────────

export interface CanvasFocus {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * Focus = the primary nodes, every edge touching one, and the neighbours at
 * the other end. Everything else dims. Used by a node click (one primary), the
 * search box, and the insight chips (many primaries at once).
 */
export function focusFor(
  primaryIds: readonly string[],
  edges: readonly CanvasEdge[],
): CanvasFocus {
  const primary = new Set(primaryIds);
  const nodes = new Set(primaryIds);
  const kept = new Set<string>();
  for (const e of edges) {
    if (primary.has(e.source) || primary.has(e.target)) {
      kept.add(e.id);
      nodes.add(e.source);
      nodes.add(e.target);
    }
  }
  return { nodes, edges: kept };
}

// ── Insights ─────────────────────────────────────────────────────────────────

export interface CanvasInsight {
  key: "no-live-creatives" | "idle-active" | "most-shared";
  label: string;
  /** The nodes a click on the chip focuses. */
  focusIds: string[];
}

/**
 * What the graph is SAYING, computed from the same graph the canvas draws.
 * Zero-case insights are omitted (the strip hides them).
 *
 *  1. Campaigns with NO LIVE creatives — every edge into them is paused-here
 *     (the health count reads 0/N). Defined on edge liveness, the same source
 *     as the health count, not on the children's general status.
 *  2. ACTIVE creatives with NO edge in this range — live, but not spending
 *     here (the query includes them as unconnected nodes for exactly this).
 *  3. The MOST SHARED creative — the one feeding the most campaigns (≥ 2, or
 *     there is no sharing to speak of). Ties go to the bigger spender.
 */
export function canvasInsights(graph: Pick<CanvasGraph, "campaigns" | "creatives" | "edges">): CanvasInsight[] {
  const out: CanvasInsight[] = [];

  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // ONE source with the health count: a campaign that spent in the range but
  // has NO live edge — nothing is currently spending there.
  const stale = graph.campaigns.filter(
    (c) => c.totalChildren > 0 && c.liveChildren === 0,
  );
  if (stale.length > 0) {
    out.push({
      key: "no-live-creatives",
      label: `${stale.length} campaign${stale.length === 1 ? "" : "s"} with no live creatives`,
      focusIds: stale.map((c) => c.id),
    });
  }

  const idle = graph.creatives.filter(
    (c) => c.status === "active" && (degree.get(c.id) ?? 0) === 0,
  );
  if (idle.length > 0) {
    out.push({
      key: "idle-active",
      label: `${idle.length} active creative${idle.length === 1 ? "" : "s"} idle in this range`,
      focusIds: idle.map((c) => c.id),
    });
  }

  let top: CanvasCreativeNode | null = null;
  let topDegree = 1;
  for (const c of graph.creatives) {
    const d = degree.get(c.id) ?? 0;
    if (d > topDegree || (d === topDegree && d > 1 && top && c.spend > top.spend)) {
      top = c;
      topDegree = d;
    }
  }
  if (top) {
    out.push({
      key: "most-shared",
      label: `Most shared: «${top.name}» feeds ${topDegree} campaigns`,
      focusIds: [top.id],
    });
  }

  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// C2 — THE VIEW SWITCHER. Same graph, same filters, same two clocks: every
// cluster view below is a pure function over what `canvasGraph()` already
// returns. Nothing here asks the database for anything.
// ═════════════════════════════════════════════════════════════════════════════

/** `?view=` — URL-backed so a comment's captured view reproduces it exactly. */
export const CANVAS_VIEWS = ["network", "campaign", "creative"] as const;
export type CanvasViewMode = (typeof CANVAS_VIEWS)[number];
export const CANVAS_VIEW_LABEL: Record<CanvasViewMode, string> = {
  network: "Network",
  campaign: "By campaign",
  creative: "By creative",
};

/** Anything that isn't a known view is the default — never an error. */
export function parseCanvasView(value: string | null | undefined): CanvasViewMode {
  return (CANVAS_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as CanvasViewMode)
    : "network";
}

/**
 * A CHIP is one occurrence inside a cluster, and it represents the PAIRING —
 * this creative IN this campaign — not the entity in general. So it carries
 * the edge's state: in the cluster views there are no lines to dash, and the
 * live / paused-here signal moves ONTO the duplicated chip. `live` here is the
 * edge's own `live`, never re-derived (one source).
 */
export interface CanvasChip {
  /** Unique per occurrence — a creative in five campaigns is five chips. */
  id: string;
  /** The entity this chip stands for (a creative or campaign node id). */
  entityId: string;
  /** The pairing's edge; null for an idle creative (it has no pairing). */
  edgeId: string | null;
  /** The pairing's liveness. An idle chip has no pairing to pause → true. */
  live: boolean;
  /** The PAIRING's range spend (not the entity's total). */
  spend: number;
  lastSpendDay: string | null;
}

export interface CanvasCluster {
  id: string;
  /** "idle" = the trailing pseudo-cluster of creatives with no campaign here. */
  kind: "campaign" | "creative" | "idle";
  /** The header entity's node id; null for the idle pseudo-cluster. */
  headerId: string | null;
  chips: CanvasChip[];
}

/** Rendered chips are capped like edges are — duplication multiplies them. */
export const CANVAS_MAX_CHIPS = 500;

export interface CanvasClusters {
  clusters: CanvasCluster[];
  /** Set when the chip cap trimmed pairings — the page SAYS so. */
  truncated: { shownChips: number; totalChips: number } | null;
}

/** Live first, then paused; each group by the pairing's spend desc. */
function byPairingState(a: CanvasChip, b: CanvasChip): number {
  if (a.live !== b.live) return a.live ? -1 : 1;
  return b.spend - a.spend || a.entityId.localeCompare(b.entityId);
}

/**
 * The cluster ("tree") views, built from the graph's edges:
 *
 *  - BY CAMPAIGN: one cluster per campaign (spend desc), its creatives as
 *    chips. A creative in five campaigns appears five times — that IS the tree
 *    semantics. Idle-active creatives (no campaign in range) form ONE trailing
 *    "idle" pseudo-cluster.
 *  - BY CREATIVE: the inverse — one cluster per creative (spend desc), its
 *    campaigns as chips; idle-active creatives are CHIPLESS headers, last.
 *
 * The chip cap keeps the TOP pairings by spend (`capEdges`, the same rule as
 * the network's scale cap) and reports what it trimmed. A header whose
 * pairings were all trimmed is dropped with them; idle creatives fill
 * whatever room is left.
 */
export function buildClusters(
  graph: Pick<CanvasGraph, "campaigns" | "creatives" | "edges">,
  view: Exclude<CanvasViewMode, "network">,
  maxChips: number = CANVAS_MAX_CHIPS,
): CanvasClusters {
  const { kept, total } = capEdges(graph.edges, Number.POSITIVE_INFINITY, maxChips);
  const connected = new Set(graph.edges.map((e) => e.target));
  const idle = graph.creatives
    .filter((c) => !connected.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const clusters: CanvasCluster[] = [];
  let totalChips = total;
  let shownChips = kept.length;

  if (view === "campaign") {
    const chipsOf = new Map<string, CanvasChip[]>();
    for (const e of kept) {
      const list = chipsOf.get(e.source) ?? [];
      list.push({
        id: `${e.source}>${e.target}`,
        entityId: e.target,
        edgeId: e.id,
        live: e.live,
        spend: e.spend,
        lastSpendDay: e.lastSpendDay,
      });
      chipsOf.set(e.source, list);
    }
    const headers = [...graph.campaigns]
      .filter((c) => chipsOf.has(c.id))
      .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
    for (const c of headers) {
      clusters.push({
        id: `cl:${c.id}`,
        kind: "campaign",
        headerId: c.id,
        chips: chipsOf.get(c.id)!.sort(byPairingState),
      });
    }
    // The idle pseudo-cluster: its chips count toward the same cap.
    totalChips += idle.length;
    const room = Math.max(0, maxChips - kept.length);
    const shownIdle = idle.slice(0, room);
    shownChips += shownIdle.length;
    if (shownIdle.length > 0) {
      clusters.push({
        id: "cl:idle",
        kind: "idle",
        headerId: null,
        chips: shownIdle.map((c) => ({
          id: `idle>${c.id}`,
          entityId: c.id,
          edgeId: null,
          live: true,
          spend: 0,
          lastSpendDay: null,
        })),
      });
    }
  } else {
    const chipsOf = new Map<string, CanvasChip[]>();
    for (const e of kept) {
      const list = chipsOf.get(e.target) ?? [];
      list.push({
        id: `${e.target}>${e.source}`,
        entityId: e.source,
        edgeId: e.id,
        live: e.live,
        spend: e.spend,
        lastSpendDay: e.lastSpendDay,
      });
      chipsOf.set(e.target, list);
    }
    const headers = [...graph.creatives]
      .filter((c) => chipsOf.has(c.id))
      .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
    for (const c of headers) {
      clusters.push({
        id: `cl:${c.id}`,
        kind: "creative",
        headerId: c.id,
        chips: chipsOf.get(c.id)!.sort(byPairingState),
      });
    }
    // Idle-active creatives: chipless headers, grouped last.
    for (const c of idle) {
      clusters.push({ id: `cl:${c.id}`, kind: "creative", headerId: c.id, chips: [] });
    }
  }

  return {
    clusters,
    truncated: shownChips < totalChips ? { shownChips, totalChips } : null,
  };
}

// ── Cluster layout ───────────────────────────────────────────────────────────

export const CHIP_WIDTH = 172;
export const CHIP_HEIGHT = 34;
export const CHIP_GAP = 8;
export const CHIP_COLS = 2;
export const CLUSTER_PAD = 12;
export const CLUSTER_GAP = 28;
/** Every cluster is one width, so they tile in clean wrapping rows. */
export const CLUSTER_WIDTH = CHIP_COLS * CHIP_WIDTH + (CHIP_COLS - 1) * CHIP_GAP + 2 * CLUSTER_PAD;
/** The idle pseudo-cluster has no header node — just a caption strip. */
export const IDLE_CAPTION_HEIGHT = 22;

export interface ClusterLayout {
  /** The cluster's frame. */
  frames: Map<string, CanvasBox>;
  /** The header node's box, keyed by CLUSTER id (absent for the idle cluster). */
  headers: Map<string, CanvasBox>;
  /** Chip boxes, keyed by chip id. */
  chips: Map<string, CanvasBox>;
  /** Cluster ids row by row — what "fit the top rows" reads. */
  rows: string[][];
}

/** How many cluster columns a pane of this width gets. One on a phone. */
export function clusterColumnsFor(paneWidth: number): number {
  if (paneWidth < 640) return 1;
  if (paneWidth < 1024) return 2;
  if (paneWidth < 1500) return 3;
  return 4;
}

/**
 * Clusters flow in WRAPPING ROWS of `columns`, in the order given (spend desc).
 * A cluster's height is its header plus its chip grid, so it is sized by child
 * count; each row is as tall as its tallest cluster, so nothing collides.
 * `headerSize` supplies the header's box (the same spend-scaled size the
 * network view draws) — it always fits, since the widest header (232 × 1.45)
 * is narrower than a cluster's inner width.
 */
export function clusterBoxes(
  clusters: readonly CanvasCluster[],
  columns: number,
  headerSize: (headerId: string) => { width: number; height: number },
): ClusterLayout {
  const cols = Math.max(1, Math.floor(columns));
  const frames = new Map<string, CanvasBox>();
  const headers = new Map<string, CanvasBox>();
  const chips = new Map<string, CanvasBox>();
  const rows: string[][] = [];

  const topOf = (c: CanvasCluster) =>
    c.headerId ? headerSize(c.headerId).height : IDLE_CAPTION_HEIGHT;
  const heightOf = (c: CanvasCluster) => {
    const chipRows = Math.ceil(c.chips.length / CHIP_COLS);
    const grid =
      chipRows > 0 ? CHIP_GAP + chipRows * CHIP_HEIGHT + (chipRows - 1) * CHIP_GAP : 0;
    return CLUSTER_PAD + topOf(c) + grid + CLUSTER_PAD;
  };

  let y = 0;
  for (let i = 0; i < clusters.length; i += cols) {
    const row = clusters.slice(i, i + cols);
    rows.push(row.map((c) => c.id));
    row.forEach((c, col) => {
      const x = col * (CLUSTER_WIDTH + CLUSTER_GAP);
      frames.set(c.id, { x, y, width: CLUSTER_WIDTH, height: heightOf(c) });
      if (c.headerId) {
        const size = headerSize(c.headerId);
        headers.set(c.id, { x: x + CLUSTER_PAD, y: y + CLUSTER_PAD, ...size });
      }
      const gridTop = y + CLUSTER_PAD + topOf(c) + CHIP_GAP;
      c.chips.forEach((chip, n) => {
        chips.set(chip.id, {
          x: x + CLUSTER_PAD + (n % CHIP_COLS) * (CHIP_WIDTH + CHIP_GAP),
          y: gridTop + Math.floor(n / CHIP_COLS) * (CHIP_HEIGHT + CHIP_GAP),
          width: CHIP_WIDTH,
          height: CHIP_HEIGHT,
        });
      });
    });
    y += Math.max(...row.map(heightOf)) + CLUSTER_GAP;
  }
  return { frames, headers, chips, rows };
}

// ── Cluster focus ────────────────────────────────────────────────────────────

/** Flow-node ids for a cluster's parts — ONE naming scheme, shared with the UI. */
export const clusterFrameId = (clusterId: string) => `f:${clusterId}`;
export const clusterHeaderId = (clusterId: string) => `h:${clusterId}`;

/**
 * Focus in a cluster view, by ENTITY id — which is what makes it work across
 * views (a focus survives a view switch: the same entity lights up in its new
 * form) and what gives the tree its answer to "what does this connect to":
 *
 *  - a focused HEADER entity lights its whole cluster;
 *  - a focused CHIP entity lights EVERY occurrence of it, plus the header of
 *    each cluster it sits in (the thing it connects to) — sibling chips dim.
 *
 * Returns the lit FLOW-node ids (frames, headers, chips), and the first lit
 * chip/header in layout order — what search pans to.
 */
export function clusterFocus(
  primaryIds: readonly string[],
  clusters: readonly CanvasCluster[],
): { lit: Set<string>; first: string | null } {
  const primary = new Set(primaryIds);
  const lit = new Set<string>();
  let first: string | null = null;
  const note = (id: string) => {
    if (first === null) first = id;
  };
  for (const c of clusters) {
    if (c.headerId && primary.has(c.headerId)) {
      lit.add(clusterFrameId(c.id));
      lit.add(clusterHeaderId(c.id));
      note(clusterHeaderId(c.id));
      for (const chip of c.chips) lit.add(chip.id);
      continue;
    }
    for (const chip of c.chips) {
      if (!primary.has(chip.entityId)) continue;
      lit.add(chip.id);
      note(chip.id);
      lit.add(clusterFrameId(c.id));
      if (c.headerId) lit.add(clusterHeaderId(c.id));
    }
  }
  return { lit, first };
}
