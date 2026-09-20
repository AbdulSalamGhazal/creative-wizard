import { describe, expect, it } from "vitest";
import {
  bipartiteOrder,
  bipartitePositions,
  canvasInsights,
  capEdges,
  edgeWidth,
  focusFor,
  CANVAS_COLUMN_GAP,
  CANVAS_NODE_WIDTH,
  CANVAS_ROW_HEIGHT,
  EDGE_MAX_WIDTH,
  EDGE_MIN_WIDTH,
  type CanvasCampaignNode,
  type CanvasCreativeNode,
  type CanvasEdge,
} from "@/lib/canvas";

const camp = (id: string, spend: number, over: Partial<CanvasCampaignNode> = {}): CanvasCampaignNode => ({
  kind: "campaign",
  id,
  campaignId: id,
  name: id,
  objective: "Sales",
  platform: "instagram",
  status: "active",
  spend,
  conversions: 0,
  revenue: 0,
  ...over,
});
const cre = (id: string, spend: number, over: Partial<CanvasCreativeNode> = {}): CanvasCreativeNode => ({
  kind: "creative",
  id,
  creativeId: id,
  name: id,
  type: "video",
  status: "active",
  priority: null,
  stages: [],
  thumbnailUrl: null,
  spend,
  conversions: 0,
  revenue: 0,
  ...over,
});
const edge = (source: string, target: string, spend = 1): CanvasEdge => ({
  id: `${source}|${target}`,
  source,
  target,
  platform: "instagram",
  spend,
});

describe("bipartiteOrder — the barycenter layout", () => {
  it("campaigns go by spend desc", () => {
    const order = bipartiteOrder({
      campaigns: [camp("small", 10), camp("big", 900), camp("mid", 100)],
      creatives: [],
      edges: [],
    });
    expect(order.campaigns).toEqual(["big", "mid", "small"]);
  });

  it("a creative sits level with the campaigns that feed it", () => {
    // Campaign rows: A=0, B=1, C=2. Listed in the WORST order on purpose.
    const order = bipartiteOrder({
      campaigns: [camp("A", 300), camp("B", 200), camp("C", 100)],
      creatives: [cre("onlyC", 1), cre("onlyA", 1), cre("AandC", 1), cre("onlyB", 1)],
      edges: [
        edge("C", "onlyC"),
        edge("A", "onlyA"),
        edge("A", "AandC"),
        edge("C", "AandC"),
        edge("B", "onlyB"),
      ],
    });
    // Barycenters: onlyA=0, AandC=(0+2)/2=1, onlyB=1, onlyC=2.
    expect(order.creatives[0]).toBe("onlyA");
    expect(order.creatives[3]).toBe("onlyC");
    expect(new Set(order.creatives.slice(1, 3))).toEqual(new Set(["AandC", "onlyB"]));
  });

  it("the ordering removes a crossing a naive order would have", () => {
    // Two campaigns, two creatives wired STRAIGHT ACROSS but listed swapped.
    const graph = {
      campaigns: [camp("top", 200), camp("bottom", 100)],
      creatives: [cre("forBottom", 1), cre("forTop", 1)],
      edges: [edge("top", "forTop"), edge("bottom", "forBottom")],
    };
    const order = bipartiteOrder(graph);
    expect(order.creatives).toEqual(["forTop", "forBottom"]);
    // Crossing check: edges (c1→k1),(c2→k2) cross iff the orders disagree.
    const row = (ids: string[]) => new Map(ids.map((id, i) => [id, i]));
    const cRow = row(order.campaigns);
    const kRow = row(order.creatives);
    const [e1, e2] = graph.edges as [CanvasEdge, CanvasEdge];
    const crosses =
      (cRow.get(e1.source)! - cRow.get(e2.source)!) *
        (kRow.get(e1.target)! - kRow.get(e2.target)!) <
      0;
    expect(crosses).toBe(false);
  });

  it("ties break by spend desc, then name — a stable order run to run", () => {
    const order = bipartiteOrder({
      campaigns: [camp("A", 100)],
      creatives: [cre("zeta", 5), cre("alpha", 5), cre("rich", 50)],
      edges: [edge("A", "zeta"), edge("A", "alpha"), edge("A", "rich")],
    });
    expect(order.creatives).toEqual(["rich", "alpha", "zeta"]);
  });

  it("unconnected (idle) creatives have no barycenter and go LAST, by name", () => {
    const order = bipartiteOrder({
      campaigns: [camp("A", 100)],
      creatives: [cre("idle-b", 0), cre("wired", 9), cre("idle-a", 0)],
      edges: [edge("A", "wired")],
    });
    expect(order.creatives).toEqual(["wired", "idle-a", "idle-b"]);
  });
});

describe("bipartitePositions", () => {
  it("campaigns left, creatives right, the shorter column centered", () => {
    const pos = bipartitePositions({ campaigns: ["A"], creatives: ["x", "y", "z"] });
    expect(pos.get("A")).toEqual({ x: 0, y: CANVAS_ROW_HEIGHT }); // centered on 3 rows
    expect(pos.get("x")).toEqual({ x: CANVAS_NODE_WIDTH + CANVAS_COLUMN_GAP, y: 0 });
    expect(pos.get("z")!.y).toBe(2 * CANVAS_ROW_HEIGHT);
  });
});

describe("edgeWidth", () => {
  it("scales by sqrt(spend) inside the min/max", () => {
    expect(edgeWidth(100, 100)).toBe(EDGE_MAX_WIDTH);
    // A quarter of the spend is HALF the width range — sqrt, not linear.
    expect(edgeWidth(25, 100)).toBeCloseTo(
      EDGE_MIN_WIDTH + (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH) * 0.5,
      9,
    );
  });
  it("never leaves the range, whatever it is fed", () => {
    expect(edgeWidth(0, 100)).toBe(EDGE_MIN_WIDTH);
    expect(edgeWidth(5, 0)).toBe(EDGE_MIN_WIDTH);
    expect(edgeWidth(500, 100)).toBe(EDGE_MAX_WIDTH);
  });
});

describe("focusFor", () => {
  const edges = [edge("A", "x"), edge("A", "y"), edge("B", "y"), edge("B", "z")];

  it("a node's focus is itself, its edges and its neighbours", () => {
    const f = focusFor(["A"], edges);
    expect([...f.nodes].sort()).toEqual(["A", "x", "y"]);
    expect([...f.edges].sort()).toEqual(["A|x", "A|y"]);
  });

  it("works from the creative side too", () => {
    const f = focusFor(["y"], edges);
    expect([...f.nodes].sort()).toEqual(["A", "B", "y"]);
  });

  it("many primaries (an insight chip) union their subgraphs", () => {
    const f = focusFor(["A", "z"], edges);
    expect([...f.nodes].sort()).toEqual(["A", "B", "x", "y", "z"]);
    expect(f.edges.has("B|y")).toBe(false); // touches neither primary
  });

  it("an unconnected node focuses alone", () => {
    const f = focusFor(["idle"], edges);
    expect([...f.nodes]).toEqual(["idle"]);
    expect(f.edges.size).toBe(0);
  });
});

describe("canvasInsights", () => {
  it("flags ACTIVE campaigns whose in-range creatives are all non-active", () => {
    const insights = canvasInsights({
      campaigns: [
        camp("stale", 100),
        camp("healthy", 100),
        camp("dead", 100, { status: "inactive" }),
      ],
      creatives: [
        cre("paused1", 1, { status: "pause" }),
        cre("term1", 1, { status: "terminated" }),
        cre("live", 1),
        cre("paused2", 1, { status: "pause" }),
      ],
      edges: [
        edge("stale", "paused1"),
        edge("stale", "term1"),
        edge("healthy", "live"),
        edge("healthy", "paused2"), // one active child is enough
        edge("dead", "paused2"), // an INACTIVE campaign is not the story
      ],
    });
    const hit = insights.find((i) => i.key === "inactive-children")!;
    expect(hit.focusIds).toEqual(["stale"]);
    expect(hit.label).toBe("1 campaign running only inactive creatives");
  });

  it("flags ACTIVE creatives with no edge in the range", () => {
    const insights = canvasInsights({
      campaigns: [camp("A", 10)],
      creatives: [cre("wired", 5), cre("idle1", 0), cre("idle2", 0), cre("pausedIdle", 0, { status: "pause" })],
      edges: [edge("A", "wired")],
    });
    const hit = insights.find((i) => i.key === "idle-active")!;
    expect(hit.focusIds.sort()).toEqual(["idle1", "idle2"]);
    expect(hit.label).toBe("2 active creatives idle in this range");
  });

  it("names the MOST SHARED creative — and only when something IS shared", () => {
    const shared = canvasInsights({
      campaigns: [camp("A", 1), camp("B", 1), camp("C", 1)],
      creatives: [cre("hub", 9), cre("pair", 9), cre("solo", 9)],
      edges: [
        edge("A", "hub"), edge("B", "hub"), edge("C", "hub"),
        edge("A", "pair"), edge("B", "pair"),
        edge("C", "solo"),
      ],
    }).find((i) => i.key === "most-shared")!;
    expect(shared.focusIds).toEqual(["hub"]);
    expect(shared.label).toBe("Most shared: «hub» feeds 3 campaigns");

    // Every creative in exactly one campaign → nothing is shared → no chip.
    const none = canvasInsights({
      campaigns: [camp("A", 1)],
      creatives: [cre("x", 1), cre("y", 1)],
      edges: [edge("A", "x"), edge("A", "y")],
    });
    expect(none.find((i) => i.key === "most-shared")).toBeUndefined();
  });

  it("a sharing tie goes to the bigger spender", () => {
    const hit = canvasInsights({
      campaigns: [camp("A", 1), camp("B", 1)],
      creatives: [cre("cheap", 10), cre("rich", 500)],
      edges: [edge("A", "cheap"), edge("B", "cheap"), edge("A", "rich"), edge("B", "rich")],
    }).find((i) => i.key === "most-shared")!;
    expect(hit.focusIds).toEqual(["rich"]);
  });

  it("zero-case insights are simply absent", () => {
    expect(
      canvasInsights({
        campaigns: [camp("A", 1)],
        creatives: [cre("x", 1)],
        edges: [edge("A", "x")],
      }),
    ).toEqual([]);
    expect(canvasInsights({ campaigns: [], creatives: [], edges: [] })).toEqual([]);
  });
});

describe("capEdges — the scale guardrail", () => {
  it("under the caps nothing is trimmed", () => {
    const r = capEdges([edge("A", "x", 5), edge("A", "y", 9)], 400, 800);
    expect(r.truncated).toBe(false);
    expect(r.kept.map((e) => e.id)).toEqual(["A|y", "A|x"]); // spend desc
  });

  it("keeps the TOP edges by spend when the edge cap bites", () => {
    const edges = Array.from({ length: 10 }, (_, i) => edge("A", `k${i}`, i + 1));
    const r = capEdges(edges, 400, 3);
    expect(r.kept.map((e) => e.spend)).toEqual([10, 9, 8]);
    expect(r.total).toBe(10);
    expect(r.truncated).toBe(true);
  });

  it("the NODE cap skips an edge that needs new nodes, but keeps walking", () => {
    const r = capEdges(
      [
        edge("A", "x", 100), // 2 nodes
        edge("B", "y", 90), // would need 2 more → over a cap of 3 → skipped
        edge("A", "z", 80), // needs 1 more → fits (3 nodes)
        edge("A", "x2", 70), // needs 1 more → over → skipped
      ],
      3,
      800,
    );
    expect(r.kept.map((e) => e.id)).toEqual(["A|x", "A|z"]);
    expect(r.truncated).toBe(true);
  });

  it("the production caps hold on a hairball", () => {
    const edges: CanvasEdge[] = [];
    for (let c = 0; c < 60; c++)
      for (let k = 0; k < 60; k++) edges.push(edge(`c${c}`, `k${k}`, c * 60 + k + 1));
    const r = capEdges(edges);
    const nodes = new Set(r.kept.flatMap((e) => [e.source, e.target]));
    expect(r.kept.length).toBeLessThanOrEqual(800);
    expect(nodes.size).toBeLessThanOrEqual(400);
    expect(r.total).toBe(3600);
    expect(r.truncated).toBe(true);
  });
});
