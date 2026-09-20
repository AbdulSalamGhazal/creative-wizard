import { describe, expect, it } from "vitest";
import {
  campaignHealth,
  canvasInsights,
  capEdges,
  creativeSide,
  edgeIsLive,
  edgeWidth,
  focusFor,
  nodeScale,
  tripartiteBoxes,
  tripartiteOrder,
  CANVAS_COLUMN_GAP,
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  CANVAS_ROW_GAP,
  EDGE_MAX_WIDTH,
  EDGE_MIN_WIDTH,
  NODE_MAX_SCALE,
  NODE_MIN_SCALE,
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
  liveChildren: 0,
  totalChildren: 0,
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
const edge = (source: string, target: string, spend = 1, live = true): CanvasEdge => ({
  id: `${source}|${target}`,
  source,
  target,
  platform: "instagram",
  spend,
  lastSpendDay: "2026-09-19",
  live,
});

describe("the two clocks — range draws the edge, the status window says if it is live", () => {
  // The platform's own latest spend day is the anchor; a 24h window is 1 day,
  // so only a pair that spent ON that day is live.
  const anchor = "2026-09-19";

  it("in range + in window → LIVE", () => {
    expect(edgeIsLive({ lastSpendDay: "2026-09-19", platformLatestDay: anchor, windowDays: 1 })).toBe(true);
  });

  it("in range + OUTSIDE the window → paused here", () => {
    // Spent a week ago — inside a 30-day range, so the edge exists, but not live.
    expect(edgeIsLive({ lastSpendDay: "2026-09-12", platformLatestDay: anchor, windowDays: 1 })).toBe(false);
  });

  it("a wider window keeps more pairs live — the brand's setting, not a constant", () => {
    const threeDays = { platformLatestDay: anchor, windowDays: 3 };
    expect(edgeIsLive({ lastSpendDay: "2026-09-17", ...threeDays })).toBe(true); // day 3 of 3
    expect(edgeIsLive({ lastSpendDay: "2026-09-16", ...threeDays })).toBe(false);
  });

  it("liveness anchors to the PLATFORM's latest day, never to today", () => {
    // A stale channel (last upload Sep 10): a pair that spent on Sep 10 is
    // live on it, however long ago that is on the calendar.
    expect(edgeIsLive({ lastSpendDay: "2026-09-10", platformLatestDay: "2026-09-10", windowDays: 1 })).toBe(true);
  });

  it("no spend day, or no anchor → not live (and never a throw)", () => {
    expect(edgeIsLive({ lastSpendDay: null, platformLatestDay: anchor, windowDays: 1 })).toBe(false);
    expect(edgeIsLive({ lastSpendDay: "2026-09-19", platformLatestDay: null, windowDays: 1 })).toBe(false);
  });

  // "Outside the range → NO edge" is the query's half of the contract: the
  // scan's HAVING drops a pair with no in-range spend before liveness is ever
  // asked. Pinned against the real database in tests/db/canvas.test.ts.
});

describe("campaignHealth — live children / children in range", () => {
  it("counts per campaign from edge liveness", () => {
    const h = campaignHealth([
      edge("A", "x", 1, true),
      edge("A", "y", 1, false),
      edge("A", "z", 1, true),
      edge("B", "y", 1, false),
    ]);
    expect(h.get("A")).toEqual({ live: 2, total: 3 });
    expect(h.get("B")).toEqual({ live: 0, total: 1 });
    expect(h.get("nobody")).toBeUndefined();
  });
});

describe("tripartiteOrder — campaigns center, creatives flank by type", () => {
  it("video goes RIGHT, everything else LEFT", () => {
    expect(creativeSide("video")).toBe("right");
    expect(creativeSide("image")).toBe("left");
    expect(creativeSide("slides")).toBe("left");
    const order = tripartiteOrder({
      campaigns: [camp("A", 1)],
      creatives: [cre("vid", 1), cre("img", 1, { type: "image" }), cre("sld", 1, { type: "slides" })],
      edges: [edge("A", "vid"), edge("A", "img"), edge("A", "sld")],
    });
    expect(order.right).toEqual(["vid"]);
    expect(new Set(order.left)).toEqual(new Set(["img", "sld"]));
  });

  it("the center stays spend desc", () => {
    const order = tripartiteOrder({
      campaigns: [camp("small", 10), camp("big", 900), camp("mid", 100)],
      creatives: [],
      edges: [],
    });
    expect(order.center).toEqual(["big", "mid", "small"]);
  });

  it("the barycenter runs PER SIDE against the center", () => {
    // Center rows: A=0, B=1, C=2. Each flank is listed in its WORST order.
    const order = tripartiteOrder({
      campaigns: [camp("A", 300), camp("B", 200), camp("C", 100)],
      creatives: [
        cre("vidC", 1), cre("vidA", 1), cre("vidAC", 1),
        cre("imgC", 1, { type: "image" }), cre("imgA", 1, { type: "image" }),
      ],
      edges: [
        edge("C", "vidC"), edge("A", "vidA"), edge("A", "vidAC"), edge("C", "vidAC"),
        edge("C", "imgC"), edge("A", "imgA"),
      ],
    });
    expect(order.right).toEqual(["vidA", "vidAC", "vidC"]); // 0, 1, 2
    expect(order.left).toEqual(["imgA", "imgC"]); // ordered independently
  });

  it("ties break by spend desc, then name — a stable order run to run", () => {
    const order = tripartiteOrder({
      campaigns: [camp("A", 100)],
      creatives: [cre("zeta", 5), cre("alpha", 5), cre("rich", 50)],
      edges: [edge("A", "zeta"), edge("A", "alpha"), edge("A", "rich")],
    });
    expect(order.right).toEqual(["rich", "alpha", "zeta"]);
  });

  it("idle creatives sit at the BOTTOM of their own type's side", () => {
    const order = tripartiteOrder({
      campaigns: [camp("A", 100)],
      creatives: [
        cre("idle-vid", 0), cre("wired-vid", 9),
        cre("idle-img", 0, { type: "image" }), cre("wired-img", 9, { type: "image" }),
      ],
      edges: [edge("A", "wired-vid"), edge("A", "wired-img")],
    });
    expect(order.right).toEqual(["wired-vid", "idle-vid"]);
    expect(order.left).toEqual(["wired-img", "idle-img"]);
  });
});

describe("nodeScale — size by sqrt(spend)", () => {
  it("runs from the min to the max bound on sqrt", () => {
    expect(nodeScale(100, 100)).toBe(NODE_MAX_SCALE);
    // A quarter of the spend is HALF way up — sqrt, so one whale doesn't
    // flatten everyone else to the minimum.
    expect(nodeScale(25, 100)).toBeCloseTo(
      NODE_MIN_SCALE + (NODE_MAX_SCALE - NODE_MIN_SCALE) * 0.5,
      9,
    );
  });
  it("idle (zero-spend) nodes and bad input sit at the minimum", () => {
    expect(nodeScale(0, 100)).toBe(NODE_MIN_SCALE);
    expect(nodeScale(5, 0)).toBe(NODE_MIN_SCALE);
    expect(nodeScale(500, 100)).toBe(NODE_MAX_SCALE); // clamped
  });
});

describe("tripartiteBoxes — three columns, sizes feed the spacing", () => {
  const graph = {
    campaigns: [camp("big", 900), camp("small", 100)],
    creatives: [
      cre("vid-rich", 400), cre("vid-poor", 25),
      cre("img", 100, { type: "image" }),
    ],
    edges: [
      edge("big", "vid-rich"), edge("small", "vid-poor"), edge("big", "img"),
    ],
  };
  const boxes = tripartiteBoxes(graph);
  const right = (id: string) => boxes.get(id)!.x + boxes.get(id)!.width;

  it("left flank < center < right flank, with a real gap between columns", () => {
    expect(right("img")).toBeLessThan(boxes.get("big")!.x);
    expect(right("big")).toBeLessThan(boxes.get("vid-rich")!.x);
    // (−1e-6: the widest node's box is built from float products.)
    expect(boxes.get("big")!.x - right("img")).toBeGreaterThanOrEqual(CANVAS_COLUMN_GAP - 1e-6);
    expect(boxes.get("vid-rich")!.x - right("big")).toBeGreaterThanOrEqual(CANVAS_COLUMN_GAP - 1e-6);
  });

  it("every edge leaves from the side FACING the center", () => {
    // Left flank is right-aligned, right flank left-aligned, center on an axis.
    const widest = CANVAS_NODE_WIDTH * NODE_MAX_SCALE;
    expect(right("img")).toBeCloseTo(widest, 6);
    expect(boxes.get("vid-rich")!.x).toBe(boxes.get("vid-poor")!.x);
    const axis = (id: string) => boxes.get(id)!.x + boxes.get(id)!.width / 2;
    expect(axis("big")).toBeCloseTo(axis("small"), 6);
  });

  it("bigger spend → a bigger box, per KIND", () => {
    expect(boxes.get("big")!.width).toBeCloseTo(CANVAS_NODE_WIDTH * NODE_MAX_SCALE, 6);
    expect(boxes.get("big")!.height).toBeCloseTo(CANVAS_NODE_HEIGHT * NODE_MAX_SCALE, 6);
    expect(boxes.get("small")!.width).toBeLessThan(boxes.get("big")!.width);
    // The richest CREATIVE is at the max too — it is scaled against creatives,
    // not against the campaigns' much larger totals.
    expect(boxes.get("vid-rich")!.width).toBeCloseTo(CANVAS_NODE_WIDTH * NODE_MAX_SCALE, 6);
  });

  it("rows never collide — each is stacked by its OWN height plus the gap", () => {
    const a = boxes.get("vid-rich")!;
    const b = boxes.get("vid-poor")!;
    expect(b.y).toBeCloseTo(a.y + a.height + CANVAS_ROW_GAP, 6);
    const c = boxes.get("big")!;
    const d = boxes.get("small")!;
    expect(d.y).toBeCloseTo(c.y + c.height + CANVAS_ROW_GAP, 6);
  });

  it("shorter columns are centered against the tallest", () => {
    // One node on the left vs two stacked elsewhere → it sits mid-height.
    const img = boxes.get("img")!;
    const tallest = Math.max(
      boxes.get("small")!.y + boxes.get("small")!.height,
      boxes.get("vid-poor")!.y + boxes.get("vid-poor")!.height,
    );
    expect(img.y + img.height / 2).toBeCloseTo(tallest / 2, 6);
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
  it("flags campaigns with NO LIVE creatives — the health count's own source", () => {
    const insights = canvasInsights({
      campaigns: [
        camp("allPaused", 100, { liveChildren: 0, totalChildren: 2 }),
        camp("oneLive", 100, { liveChildren: 1, totalChildren: 3 }),
        // An ACTIVE-status creative whose edge HERE is paused still leaves this
        // campaign with nobody live — the old child-status rule missed this.
        camp("pausedHere", 100, { liveChildren: 0, totalChildren: 1 }),
      ],
      creatives: [cre("p1", 1, { status: "pause" }), cre("p2", 1, { status: "pause" }), cre("liveElsewhere", 1)],
      edges: [
        edge("allPaused", "p1", 1, false),
        edge("allPaused", "p2", 1, false),
        edge("oneLive", "liveElsewhere", 1, true),
        edge("pausedHere", "liveElsewhere", 1, false),
      ],
    });
    const hit = insights.find((i) => i.key === "no-live-creatives")!;
    expect(hit.focusIds.sort()).toEqual(["allPaused", "pausedHere"]);
    expect(hit.label).toBe("2 campaigns with no live creatives");
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
