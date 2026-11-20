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
import { rateBlock, rulesForScope, type Rating, type RatingConfig } from "@/lib/rating";

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
  /** LAUNCHED: its first-ever real-spend day, when that falls in the range. */
  launchedOn: string | null;
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
  /**
   * LAUNCHED: its first-ever real-spend day, when that falls in the range —
   * null for anything that spent before it (or is idle). Judged under the
   * canvas's platform filter and Excluded toggle, never its creative filters.
   */
  launchedOn: string | null;
  /** Its angles, sorted — the By angle view's clusters (C8). */
  angles: string[];
  /**
   * The CREATIVE's own range ROAS and Rate (all its campaigns together) —
   * the By angle chip's colour. Summary's rule: one platform filtered → that
   * platform's rules, else the brand default. Idle: null / "na".
   */
  roas: number | null;
  rate: Rating;
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
  /** The pair's in-range revenue ÷ in-range spend (component sums). */
  roas: number | null;
  /** The pair's RATE — see {@link pairRate}. What the Rate lens colours by. */
  rate: Rating;
}

// ── Performance lens ─────────────────────────────────────────────────────────

/**
 * The PERFORMANCE LENS recolours the pairings; it never restates a number.
 * "Platform" (the default, the clean URL) colours a line by its campaign's
 * platform; "Rate" colours it by the pairing's Rate.
 */
export const CANVAS_LENSES = ["platform", "rate"] as const;
export type CanvasLens = (typeof CANVAS_LENSES)[number];

export const CANVAS_LENS_LABEL: Record<CanvasLens, string> = {
  platform: "Platform",
  rate: "Rate",
};

/** `?lens=` → a lens; anything unknown is the platform lens. */
export function parseCanvasLens(value: string | null | undefined): CanvasLens {
  return (CANVAS_LENSES as readonly string[]).includes(value ?? "")
    ? (value as CanvasLens)
    : "platform";
}

/**
 * A PAIRING's Rate: the system's one rating rule (`rateBlock`) over the pair's
 * own in-range sums, judged by the rules of the campaign's platform (its
 * override, else the brand default) — the same Good / Decent / Bad / N/A, the
 * same min spend, the Summary's Rate column uses. ROAS is Σrevenue ÷ Σspend,
 * never an average of daily ratios.
 */
export function pairRate(
  input: { spend: number; revenue: number; platform: string },
  config: RatingConfig,
): { roas: number | null; rate: Rating } {
  const roas = input.spend > 0 ? input.revenue / input.spend : null;
  return { roas, rate: rateBlock({ spend: input.spend, roas }, rulesForScope(config, input.platform)) };
}

/**
 * A CREATIVE's own Rate over its range sums (C8) — Summary's scope rule: one
 * platform filtered → that platform's rules, else the brand default.
 */
export function creativeRate(
  input: { spend: number; revenue: number },
  platforms: readonly string[] | undefined,
  config: RatingConfig,
): { roas: number | null; rate: Rating } {
  const roas = input.spend > 0 ? input.revenue / input.spend : null;
  const scope = platforms && platforms.length === 1 ? platforms[0]! : "total";
  return { roas, rate: rateBlock({ spend: input.spend, roas }, rulesForScope(config, scope)) };
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

/** The earlier of two ISO days (null = none). */
export function earlierDay(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

export const campaignNodeId = (id: string) => `c:${id}`;
export const creativeNodeId = (id: string) => `k:${id}`;

// ── Focus in the link ───────────────────────────────────────────────────────

/**
 * `?focus=` — the INSPECTED entity, as its graph node id (`c:<uuid>` a
 * campaign, `k:<uuid>` a creative). A node id, not a name, so a rename never
 * breaks a shared link. Anything else parses to null — a bad value is simply
 * no focus. One parser for the server (`validators/canvas.ts`) and the client.
 */
export interface CanvasFocusParam {
  kind: "campaign" | "creative";
  /** The entity's row id. */
  id: string;
  /** Its graph node id — what the canvas focuses. */
  nodeId: string;
}

const FOCUS_RE = /^([ck]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseCanvasFocus(value: string | null | undefined): CanvasFocusParam | null {
  const m = FOCUS_RE.exec(value ?? "");
  if (!m?.[1] || !m[2]) return null;
  const id = m[2].toLowerCase();
  return m[1] === "c"
    ? { kind: "campaign", id, nodeId: campaignNodeId(id) }
    : { kind: "creative", id, nodeId: creativeNodeId(id) };
}

/**
 * What the page resolved about a link's `?focus=`: drawn → open on it; not
 * drawn → say which one (its brand-scoped name, null when unknown).
 */
export interface CanvasLinkedFocus {
  nodeId: string;
  kind: CanvasFocusParam["kind"];
  drawn: boolean;
  name: string | null;
}

/** The URL value the canvas writes for a focus: only an INSPECTED node. */
export function focusParamFor(
  focus: { ids: string[]; inspect?: boolean } | null,
): string | null {
  return focus?.inspect && focus.ids.length === 1 ? (focus.ids[0] ?? null) : null;
}

/**
 * The way INTO the Canvas from an entity's own page: focused on it, over that
 * page's range. Only the range travels — the Canvas's other filters are its
 * own (remembered per user), exactly like the Compare link.
 */
export function canvasFocusHref(
  entity: { campaignId: string } | { creativeId: string },
  range: { from: string; to: string },
): string {
  const p = new URLSearchParams();
  p.set(
    "focus",
    "campaignId" in entity ? campaignNodeId(entity.campaignId) : creativeNodeId(entity.creativeId),
  );
  p.set("from", range.from);
  p.set("to", range.to);
  return `/canvas?${p.toString()}`;
}

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
  key:
    | "no-live-creatives"
    | "idle-active"
    | "losing-everywhere"
    | "leans-on-one"
    | "unscaled-winner"
    | "launched"
    | "most-shared";
  label: string;
  /** The nodes a click on the chip focuses. */
  focusIds: string[];
}

/** LEANS ON ONE: the top creative's share of the campaign's range spend. */
export const LEAN_SHARE = 0.7;
/** LOSING EVERYWHERE: how many Bad pairings it takes. */
export const LOSER_MIN_BAD = 2;

/**
 * What the graph is SAYING, computed from the same graph the canvas draws.
 * Zero-case insights are omitted (the strip hides them).
 *
 *  1. Campaigns with NO LIVE creatives — every edge into them is paused-here
 *     (the health count reads 0/N). Defined on edge liveness, the same source
 *     as the health count, not on the children's general status.
 *  2. ACTIVE creatives with NO edge in this range — live, but not spending
 *     here (the query includes them as unconnected nodes for exactly this).
 *  3–5. The RATE patterns (user-confirmed definitions, 2026-11-20):
 *     LOSING EVERYWHERE — a creative rated Bad in ≥ 2 campaigns and Good or
 *     Decent in none (N/A ignored); LEANS ON ONE — a campaign with 2+
 *     creatives where one took ≥ 70% of its range spend; UNSCALED WINNER — a
 *     creative in ONE campaign whose pairing is rated Good and still live.
 *  6. The MOST SHARED creative — the one feeding the most campaigns (≥ 2, or
 *     there is no sharing to speak of). Ties go to the bigger spender.
 *
 * Strip order: the problems first, the existing chips keep their places.
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

  // ── The Rate patterns (C5). Every verdict is the edge's own `rate` / `live`
  // — never re-derived — and every share is against the campaign's TRUE range
  // spend, which the status filter and the cap never restate.
  const edgesOf = new Map<string, CanvasEdge[]>();
  for (const e of graph.edges) {
    for (const id of [e.source, e.target]) {
      const list = edgesOf.get(id) ?? [];
      list.push(e);
      edgesOf.set(id, list);
    }
  }

  // LOSING EVERYWHERE: Bad in ≥ 2 campaigns and never Good or Decent
  // (pairings too small to judge — N/A — say nothing either way).
  const losing = graph.creatives.filter((c) => {
    const rated = (edgesOf.get(c.id) ?? []).filter((e) => e.rate !== "na");
    return (
      rated.filter((e) => e.rate === "bad").length >= LOSER_MIN_BAD &&
      rated.every((e) => e.rate === "bad")
    );
  });
  if (losing.length > 0) {
    out.push({
      key: "losing-everywhere",
      label: `${losing.length} creative${losing.length === 1 ? "" : "s"} losing everywhere`,
      focusIds: losing.map((c) => c.id),
    });
  }

  // LEANS ON ONE: one creative took ≥ LEAN_SHARE of the campaign's range
  // spend, in a campaign that ran 2+ creatives (`totalChildren`, the true
  // count — a one-creative campaign is 100% by construction, not a finding).
  const leaning = graph.campaigns.filter((c) => {
    if (c.totalChildren < 2 || c.spend <= 0) return false;
    const top = Math.max(0, ...(edgesOf.get(c.id) ?? []).map((e) => e.spend));
    return top / c.spend >= LEAN_SHARE;
  });
  if (leaning.length > 0) {
    out.push({
      key: "leans-on-one",
      label: `${leaning.length} campaign${leaning.length === 1 ? " leans" : "s lean"} on one creative`,
      focusIds: leaning.map((c) => c.id),
    });
  }

  // UNSCALED WINNER: one campaign in the range, and that pairing is rated
  // Good AND still live (a paused Good pairing was likely stopped on purpose).
  const winners = graph.creatives.filter((c) => {
    const es = edgesOf.get(c.id) ?? [];
    return es.length === 1 && es[0]!.rate === "good" && es[0]!.live;
  });
  if (winners.length > 0) {
    out.push({
      key: "unscaled-winner",
      label: `${winners.length} winner${winners.length === 1 ? "" : "s"} in one campaign only`,
      focusIds: winners.map((c) => c.id),
    });
  }

  // LAUNCHED: first-ever real spend inside the range — creatives AND
  // campaigns (C7). Informational, so it sits after the problems.
  const launched = [...graph.creatives, ...graph.campaigns].filter((n) => n.launchedOn !== null);
  if (launched.length > 0) {
    out.push({
      key: "launched",
      label: `${launched.length} launched this range`,
      focusIds: launched.map((n) => n.id),
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
export const CANVAS_VIEWS = ["network", "campaign", "creative", "angle"] as const;
export type CanvasViewMode = (typeof CANVAS_VIEWS)[number];
export const CANVAS_VIEW_LABEL: Record<CanvasViewMode, string> = {
  network: "Network",
  campaign: "By campaign",
  creative: "By creative",
  angle: "By angle",
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
  /** The pairing's ROAS and Rate — the edge's, never re-derived. Idle: null / na. */
  roas: number | null;
  rate: Rating;
  lastSpendDay: string | null;
  /**
   * By angle (C8): the chip is the WHOLE creative, not a pairing — its spend,
   * ROAS and Rate are the creative's own, and `live` = spending in any
   * campaign now. Absent on pairing chips.
   */
  whole?: true;
}

/**
 * An ANGLE cluster's header (C8). Not an entity: its id is `a:<angle>` (`a:`
 * for "No angle"), which the cluster focus lights like any header. Figures
 * are sums over its creatives — a creative with several angles counts in
 * each, so headers don't add up to the brand total (the header says so).
 */
export interface CanvasAngleHeader {
  id: string;
  /** null = the "No angle" cluster. */
  name: string | null;
  spend: number;
  revenue: number;
  roas: number | null;
  /** Creatives here spending in any campaign now / creatives here that spent. */
  live: number;
  total: number;
}

export const ANGLE_HEADER_PREFIX = "a:";
export const angleHeaderId = (name: string | null) => `${ANGLE_HEADER_PREFIX}${name ?? ""}`;
export const isAngleHeaderId = (id: string) => id.startsWith(ANGLE_HEADER_PREFIX);
/** The angle header's box — fixed, not spend-scaled (an angle has no node). */
export const ANGLE_HEADER_WIDTH = 232;
export const ANGLE_HEADER_HEIGHT = 56;

export interface CanvasCluster {
  id: string;
  /** "idle" = the trailing pseudo-cluster of creatives with no campaign here. */
  kind: "campaign" | "creative" | "angle" | "idle";
  /** The header entity's node id (an angle's `a:` id); null for idle. */
  headerId: string | null;
  chips: CanvasChip[];
  /** Set on an angle cluster: what its header shows. */
  angle?: CanvasAngleHeader;
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

  if (view === "angle") return angleClusters(graph, idle, maxChips);

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
        roas: e.roas,
        rate: e.rate,
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
          roas: null,
          rate: "na",
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
        roas: e.roas,
        rate: e.rate,
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

/**
 * BY ANGLE (C8): one cluster per angle (spend desc), its CREATIVES as whole
 * chips — a creative with two angles is in both. "No angle" trails the
 * angles; idle-active creatives keep their own trailing cluster, as By
 * campaign. The chip cap keeps the top occurrences by spend and SAYS so.
 */
function angleClusters(
  graph: Pick<CanvasGraph, "creatives" | "edges">,
  idle: CanvasCreativeNode[],
  maxChips: number,
): CanvasClusters {
  const liveIds = new Set(graph.edges.filter((e) => e.live).map((e) => e.target));
  const spent = graph.creatives.filter((c) => c.spend > 0);

  type Occ = { angle: string | null; c: CanvasCreativeNode };
  const occ: Occ[] = [];
  for (const c of spent) {
    if (c.angles.length === 0) occ.push({ angle: null, c });
    else for (const a of c.angles) occ.push({ angle: a, c });
  }
  const totalOcc = occ.length;
  const kept = [...occ].sort((x, y) => y.c.spend - x.c.spend || x.c.name.localeCompare(y.c.name)).slice(0, maxChips);

  const groups = new Map<string, { name: string | null; members: CanvasCreativeNode[] }>();
  for (const { angle, c } of kept) {
    const id = angleHeaderId(angle);
    const g = groups.get(id) ?? { name: angle, members: [] };
    g.members.push(c);
    groups.set(id, g);
  }

  const clusters: CanvasCluster[] = [...groups.entries()]
    .map(([id, g]): CanvasCluster => {
      const spend = g.members.reduce((m, c) => m + c.spend, 0);
      const revenue = g.members.reduce((m, c) => m + c.revenue, 0);
      const chips: CanvasChip[] = g.members
        .map((c) => ({
          id: `${id}>${c.id}`,
          entityId: c.id,
          edgeId: null,
          live: liveIds.has(c.id),
          spend: c.spend,
          roas: c.roas,
          rate: c.rate,
          lastSpendDay: null,
          whole: true as const,
        }))
        .sort(byPairingState);
      return {
        id: `cl:${id}`,
        kind: "angle",
        headerId: id,
        chips,
        angle: {
          id,
          name: g.name,
          spend,
          revenue,
          roas: spend > 0 ? revenue / spend : null,
          live: chips.filter((ch) => ch.live).length,
          total: chips.length,
        },
      };
    })
    .sort((a, b) => {
      // "No angle" trails every named angle.
      const an = a.angle!.name === null, bn = b.angle!.name === null;
      if (an !== bn) return an ? 1 : -1;
      return b.angle!.spend - a.angle!.spend || (a.angle!.name ?? "").localeCompare(b.angle!.name ?? "");
    });

  let shownChips = kept.length;
  const totalChips = totalOcc + idle.length;
  const shownIdle = idle.slice(0, Math.max(0, maxChips - kept.length));
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
        roas: null,
        rate: "na",
        lastSpendDay: null,
      })),
    });
  }
  return { clusters, truncated: shownChips < totalChips ? { shownChips, totalChips } : null };
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

// ── Click inspector ─────────────────────────────────────────────────────────

/** One pairing as the inspector lists it: the node at the other end + the edge. */
export interface InspectorPairing {
  other: CanvasNode;
  edge: CanvasEdge;
  /** This pairing's spend ÷ the INSPECTED node's range spend; null if that is 0. */
  share: number | null;
}

export interface CanvasInspection {
  node: CanvasNode;
  /** Live first, then spend desc — the cluster chips' order. */
  pairings: InspectorPairing[];
  /**
   * Pairings the status filter or the scale cap HID. A campaign knows its true
   * count (`totalChildren`, counted over every scanned edge), so the number is
   * exact; a creative's list can only be partial when the cap bit, so it is
   * `"unknown"` then and `0` otherwise.
   */
  hiddenPairings: number | "unknown";
  /** Range ROAS and CPA from the node's own sums — never averages. */
  roas: number | null;
  cpa: number | null;
}

/**
 * The CLICK INSPECTOR reads the graph the canvas draws: no query, no new
 * number. Unknown id (filtered out, or a frame) → null.
 */
export function inspectFor(
  entityId: string,
  graph: Pick<CanvasGraph, "campaigns" | "creatives" | "edges" | "truncated">,
): CanvasInspection | null {
  const byId = new Map<string, CanvasNode>();
  for (const n of graph.campaigns) byId.set(n.id, n);
  for (const n of graph.creatives) byId.set(n.id, n);
  const node = byId.get(entityId);
  if (!node) return null;

  const pairings: InspectorPairing[] = [];
  for (const edge of graph.edges) {
    const otherId =
      edge.source === entityId ? edge.target : edge.target === entityId ? edge.source : null;
    if (!otherId) continue;
    const other = byId.get(otherId);
    if (!other) continue;
    pairings.push({ other, edge, share: node.spend > 0 ? edge.spend / node.spend : null });
  }
  pairings.sort(
    (a, b) =>
      (a.edge.live === b.edge.live ? 0 : a.edge.live ? -1 : 1) ||
      b.edge.spend - a.edge.spend ||
      a.other.name.localeCompare(b.other.name),
  );

  const hiddenPairings: number | "unknown" =
    node.kind === "campaign"
      ? Math.max(0, node.totalChildren - pairings.length)
      : graph.truncated && graph.truncated.shownEdges < graph.truncated.totalEdges
        ? "unknown"
        : 0;

  return {
    node,
    pairings,
    hiddenPairings,
    roas: node.spend > 0 ? node.revenue / node.spend : null,
    cpa: node.conversions > 0 ? node.spend / node.conversions : null,
  };
}
