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
import type { CampaignStatus } from "@/lib/campaign-status";

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

export const CANVAS_NODE_WIDTH = 248;
/** Nodes have FIXED dimensions: the layout knows them up front, so the canvas
 *  never waits on DOM measurement (fitView and the minimap need sizes, and a
 *  controlled node list with no change handler never receives measured ones). */
export const CANVAS_NODE_HEIGHT = 56;
export const CANVAS_ROW_HEIGHT = 76;
export const CANVAS_COLUMN_GAP = 420;

/**
 * Column ORDER for the bipartite layout — no layout engine, two rules:
 *  - campaigns by spend desc (the biggest story on top);
 *  - creatives by the BARYCENTER heuristic: the average row index of the
 *    campaigns each one connects to, so a creative sits level with what feeds
 *    it and edges cross less. Ties break by spend desc, then name, so the
 *    order is stable run to run. Unconnected creatives (the "active but idle"
 *    ones) have no barycenter and go LAST, by name.
 */
export function bipartiteOrder(graph: Pick<CanvasGraph, "campaigns" | "creatives" | "edges">): {
  campaigns: string[];
  creatives: string[];
} {
  const campaigns = [...graph.campaigns]
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
    .map((c) => c.id);
  const rowOf = new Map(campaigns.map((id, i) => [id, i]));

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

  const creatives = [...graph.creatives]
    .sort((a, b) => {
      const ba = bary(a.id);
      const bb = bary(b.id);
      if (ba === null && bb === null) return a.name.localeCompare(b.name);
      if (ba === null) return 1;
      if (bb === null) return -1;
      return ba - bb || b.spend - a.spend || a.name.localeCompare(b.name);
    })
    .map((c) => c.id);

  return { campaigns, creatives };
}

/** Concrete positions from the order: campaigns left, creatives right. The
 *  shorter column is centered against the taller one. */
export function bipartitePositions(
  order: { campaigns: string[]; creatives: string[] },
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const tall = Math.max(order.campaigns.length, order.creatives.length);
  const offset = (n: number) => ((tall - n) * CANVAS_ROW_HEIGHT) / 2;
  const left = offset(order.campaigns.length);
  const right = offset(order.creatives.length);
  order.campaigns.forEach((id, i) =>
    out.set(id, { x: 0, y: left + i * CANVAS_ROW_HEIGHT }),
  );
  order.creatives.forEach((id, i) =>
    out.set(id, {
      x: CANVAS_NODE_WIDTH + CANVAS_COLUMN_GAP,
      y: right + i * CANVAS_ROW_HEIGHT,
    }),
  );
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
  key: "inactive-children" | "idle-active" | "most-shared";
  label: string;
  /** The nodes a click on the chip focuses. */
  focusIds: string[];
}

/**
 * What the graph is SAYING, computed from the same graph the canvas draws.
 * Zero-case insights are omitted (the strip hides them).
 *
 *  1. ACTIVE campaigns whose creatives-in-range are ALL non-active — money is
 *     running through creatives the status system already considers stopped.
 *  2. ACTIVE creatives with NO edge in this range — live, but not spending
 *     here (the query includes them as unconnected nodes for exactly this).
 *  3. The MOST SHARED creative — the one feeding the most campaigns (≥ 2, or
 *     there is no sharing to speak of). Ties go to the bigger spender.
 */
export function canvasInsights(graph: Pick<CanvasGraph, "campaigns" | "creatives" | "edges">): CanvasInsight[] {
  const out: CanvasInsight[] = [];
  const creativeById = new Map(graph.creatives.map((c) => [c.id, c]));

  const children = new Map<string, string[]>();
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    const list = children.get(e.source) ?? [];
    list.push(e.target);
    children.set(e.source, list);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const stale = graph.campaigns.filter((c) => {
    if (c.status !== "active") return false;
    const kids = children.get(c.id) ?? [];
    return (
      kids.length > 0 &&
      kids.every((id) => creativeById.get(id)?.status !== "active")
    );
  });
  if (stale.length > 0) {
    out.push({
      key: "inactive-children",
      label: `${stale.length} campaign${stale.length === 1 ? "" : "s"} running only inactive creatives`,
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
