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
  const maxCampaign = graph.campaigns.reduce((m, c) => Math.max(m, c.spend), 0);
  const maxCreative = graph.creatives.reduce((m, c) => Math.max(m, c.spend), 0);
  const scale = new Map<string, number>();
  for (const c of graph.campaigns) scale.set(c.id, nodeScale(c.spend, maxCampaign));
  for (const c of graph.creatives) scale.set(c.id, nodeScale(c.spend, maxCreative));

  const size = (id: string) => {
    const k = scale.get(id) ?? NODE_MIN_SCALE;
    return { width: CANVAS_NODE_WIDTH * k, height: CANVAS_NODE_HEIGHT * k };
  };
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
