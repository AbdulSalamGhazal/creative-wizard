import { describe, expect, it } from "vitest";
import {
  buildClusters,
  clusterBoxes,
  clusterColumnsFor,
  clusterFocus,
  clusterFrameId,
  clusterHeaderId,
  inspectFor,
  pairRate,
  parseCanvasLens,
  parseCanvasView,
  CHIP_COLS,
  CHIP_GAP,
  CHIP_HEIGHT,
  CHIP_WIDTH,
  CLUSTER_GAP,
  CLUSTER_PAD,
  CLUSTER_WIDTH,
  IDLE_CAPTION_HEIGHT,
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
  roas: null,
  rate: "na",
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

// ═══════════════════════════ C2 — the view switcher ═════════════════════════

describe("parseCanvasView — ?view= validation", () => {
  it("accepts the three views", () => {
    expect(parseCanvasView("network")).toBe("network");
    expect(parseCanvasView("campaign")).toBe("campaign");
    expect(parseCanvasView("creative")).toBe("creative");
  });
  it("anything else is the default — never an error", () => {
    for (const bad of [null, undefined, "", "trees", "Campaign", "network "]) {
      expect(parseCanvasView(bad)).toBe("network");
    }
  });
});

describe("buildClusters — the trees", () => {
  // `hub` runs in all three campaigns; `solo` in one; two idle creatives.
  const graph = {
    campaigns: [camp("small", 100), camp("big", 900), camp("mid", 400)],
    creatives: [
      cre("hub", 700), cre("solo", 300), cre("pausedBig", 250),
      cre("idle-b", 0), cre("idle-a", 0),
    ],
    edges: [
      edge("big", "hub", 500, true),
      edge("big", "pausedBig", 250, false),
      edge("big", "solo", 150, true),
      edge("mid", "hub", 150, false),
      edge("small", "hub", 50, true),
    ],
  };

  describe("by campaign", () => {
    const { clusters, truncated } = buildClusters(graph, "campaign");

    it("one cluster per campaign, spend desc, then ONE trailing idle pseudo-cluster", () => {
      expect(clusters.map((c) => c.headerId ?? c.kind)).toEqual(["big", "mid", "small", "idle"]);
      expect(truncated).toBeNull();
    });

    it("DUPLICATION is the semantics: a creative in three campaigns is three chips", () => {
      const occurrences = clusters.flatMap((c) => c.chips).filter((ch) => ch.entityId === "hub");
      expect(occurrences).toHaveLength(3);
      expect(new Set(occurrences.map((ch) => ch.id)).size).toBe(3); // distinct ids
    });

    it("the chip is the PAIRING — it carries the edge's own state and spend", () => {
      const inMid = clusters.find((c) => c.headerId === "mid")!.chips[0]!;
      expect(inMid.entityId).toBe("hub");
      expect(inMid.live).toBe(false); // paused HERE…
      expect(inMid.spend).toBe(150); // …the pairing's spend, not hub's 700
      const inBig = clusters.find((c) => c.headerId === "big")!.chips.find((ch) => ch.entityId === "hub")!;
      expect(inBig.live).toBe(true); // …while the same creative is live THERE
      expect(inBig.edgeId).toBe("big|hub");
    });

    it("inside a cluster: live chips first, then paused, each by spend desc", () => {
      const big = clusters.find((c) => c.headerId === "big")!;
      // pausedBig (250) outspends solo (150) but is PAUSED, so it goes after.
      expect(big.chips.map((ch) => ch.entityId)).toEqual(["hub", "solo", "pausedBig"]);
    });

    it("idle creatives are chips of the idle cluster, by name, with no pairing", () => {
      const idle = clusters.at(-1)!;
      expect(idle.headerId).toBeNull();
      expect(idle.chips.map((ch) => ch.entityId)).toEqual(["idle-a", "idle-b"]);
      expect(idle.chips.every((ch) => ch.edgeId === null && ch.live)).toBe(true);
    });
  });

  describe("by creative (the inverse)", () => {
    const { clusters } = buildClusters(graph, "creative");

    it("one cluster per creative by spend; idle creatives are CHIPLESS headers, last", () => {
      expect(clusters.map((c) => c.headerId)).toEqual(["hub", "solo", "pausedBig", "idle-a", "idle-b"]);
      expect(clusters.slice(-2).every((c) => c.chips.length === 0)).toBe(true);
    });

    it("campaign chips carry that pairing's liveness, same ordering rule", () => {
      const hub = clusters.find((c) => c.headerId === "hub")!;
      // live: big (500), small (50) — then paused: mid (150).
      expect(hub.chips.map((ch) => ch.entityId)).toEqual(["big", "small", "mid"]);
      expect(hub.chips.map((ch) => ch.live)).toEqual([true, true, false]);
    });
  });

  it("the chip CAP keeps the top pairings by spend and says what it trimmed", () => {
    const { clusters, truncated } = buildClusters(graph, "campaign", 3);
    const chips = clusters.flatMap((c) => c.chips);
    expect(chips.map((ch) => ch.spend).sort((a, b) => b - a)).toEqual([500, 250, 150]);
    // 5 pairings + 2 idle = 7 possible chips, 3 shown.
    expect(truncated).toEqual({ shownChips: 3, totalChips: 7 });
    // A campaign whose pairings were all trimmed goes with them…
    expect(clusters.some((c) => c.headerId === "small")).toBe(false);
    // …and idle creatives only fill room that is left (none here).
    expect(clusters.some((c) => c.kind === "idle")).toBe(false);
  });

  it("the production cap holds under duplication", () => {
    const campaigns = Array.from({ length: 30 }, (_, i) => camp(`c${i}`, 1000 - i));
    const creatives = Array.from({ length: 30 }, (_, i) => cre(`k${i}`, 1000 - i));
    const edges = campaigns.flatMap((c, ci) => creatives.map((k, ki) => edge(c.id, k.id, ci * 30 + ki + 1)));
    const { clusters, truncated } = buildClusters({ campaigns, creatives, edges }, "creative");
    expect(clusters.flatMap((c) => c.chips).length).toBe(500);
    expect(truncated).toEqual({ shownChips: 500, totalChips: 900 });
  });
});

describe("clusterBoxes — wrapping rows, sized by child count", () => {
  const header = () => ({ width: 232, height: 56 });
  const mk = (id: string, n: number, headerId: string | null = id) => ({
    id: `cl:${id}`,
    kind: headerId ? ("campaign" as const) : ("idle" as const),
    headerId,
    chips: Array.from({ length: n }, (_, i) => ({
      id: `${id}>${i}`, entityId: `k${i}`, edgeId: `${id}|k${i}`, live: true, spend: 1,
      roas: null, rate: "na" as const, lastSpendDay: null,
    })),
  });
  const clusters = [mk("A", 5), mk("B", 1), mk("C", 2), mk("D", 0), mk("idle", 3, null)];

  it("wraps after `columns` clusters, in the given order", () => {
    const l = clusterBoxes(clusters, 2, header);
    expect(l.rows).toEqual([["cl:A", "cl:B"], ["cl:C", "cl:D"], ["cl:idle"]]);
    expect(l.frames.get("cl:B")!.x).toBe(CLUSTER_WIDTH + CLUSTER_GAP);
    expect(l.frames.get("cl:C")!.x).toBe(0); // wrapped
  });

  it("a cluster's height grows with its chip rows", () => {
    const l = clusterBoxes(clusters, 4, header);
    const h = (rows: number) =>
      CLUSTER_PAD + 56 + (rows ? CHIP_GAP + rows * CHIP_HEIGHT + (rows - 1) * CHIP_GAP : 0) + CLUSTER_PAD;
    expect(l.frames.get("cl:A")!.height).toBe(h(Math.ceil(5 / CHIP_COLS)));
    expect(l.frames.get("cl:B")!.height).toBe(h(1));
    expect(l.frames.get("cl:D")!.height).toBe(h(0)); // a chipless header
  });

  it("each row is as tall as its tallest cluster — rows never collide", () => {
    const l = clusterBoxes(clusters, 2, header);
    const rowOneBottom = l.frames.get("cl:A")!.y + l.frames.get("cl:A")!.height; // A is taller than B
    expect(l.frames.get("cl:C")!.y).toBe(rowOneBottom + CLUSTER_GAP);
    expect(l.frames.get("cl:D")!.y).toBe(l.frames.get("cl:C")!.y);
  });

  it("chips sit in a grid INSIDE their frame, under the header", () => {
    const l = clusterBoxes(clusters, 4, header);
    const frame = l.frames.get("cl:A")!;
    const head = l.headers.get("cl:A")!;
    expect(head.x).toBe(frame.x + CLUSTER_PAD);
    for (let i = 0; i < 5; i++) {
      const chip = l.chips.get(`A>${i}`)!;
      expect(chip.x).toBeGreaterThanOrEqual(frame.x + CLUSTER_PAD);
      expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width - CLUSTER_PAD);
      expect(chip.y).toBeGreaterThanOrEqual(head.y + head.height + CHIP_GAP);
      expect(chip.y + chip.height).toBeLessThanOrEqual(frame.y + frame.height - CLUSTER_PAD);
    }
    // Two per row: chip 2 starts the second row, directly under chip 0.
    expect(l.chips.get("A>2")!.x).toBe(l.chips.get("A>0")!.x);
    expect(l.chips.get("A>1")!.x).toBe(l.chips.get("A>0")!.x + CHIP_WIDTH + CHIP_GAP);
  });

  it("the idle pseudo-cluster has a caption strip instead of a header node", () => {
    const l = clusterBoxes(clusters, 4, header);
    expect(l.headers.has("cl:idle")).toBe(false);
    const frame = l.frames.get("cl:idle")!;
    expect(l.chips.get("idle>0")!.y).toBe(frame.y + CLUSTER_PAD + IDLE_CAPTION_HEIGHT + CHIP_GAP);
  });

  it("a phone gets ONE column; wider panes get more", () => {
    expect(clusterColumnsFor(351)).toBe(1);
    expect(clusterColumnsFor(800)).toBe(2);
    expect(clusterColumnsFor(1200)).toBe(3);
    expect(clusterColumnsFor(1700)).toBe(4);
    const l = clusterBoxes(clusters, clusterColumnsFor(351), header);
    expect(l.rows.every((r) => r.length === 1)).toBe(true);
    expect([...l.frames.values()].every((f) => f.x === 0)).toBe(true);
  });
});

describe("clusterFocus — by entity, so every duplicate lights", () => {
  const graph = {
    campaigns: [camp("A", 300), camp("B", 200)],
    creatives: [cre("hub", 9), cre("onlyA", 5), cre("idle", 0)],
    edges: [edge("A", "hub", 5), edge("A", "onlyA", 4), edge("B", "hub", 3)],
  };
  const { clusters } = buildClusters(graph, "campaign");

  it("a CHIP entity lights EVERY occurrence, plus the header of each cluster it sits in", () => {
    const { lit, first } = clusterFocus(["hub"], clusters);
    expect(lit.has("A>hub")).toBe(true);
    expect(lit.has("B>hub")).toBe(true);
    expect(lit.has(clusterHeaderId("cl:A"))).toBe(true); // what it connects to
    expect(lit.has(clusterHeaderId("cl:B"))).toBe(true);
    expect(lit.has("A>onlyA")).toBe(false); // a sibling chip dims
    // Search pans to the FIRST occurrence — cluster A leads (bigger spend).
    expect(first).toBe("A>hub");
  });

  it("a HEADER entity lights its whole cluster, and only that one", () => {
    const { lit, first } = clusterFocus(["A"], clusters);
    expect(lit.has(clusterFrameId("cl:A"))).toBe(true);
    expect(lit.has("A>hub")).toBe(true);
    expect(lit.has("A>onlyA")).toBe(true);
    expect(lit.has("B>hub")).toBe(false);
    expect(first).toBe(clusterHeaderId("cl:A"));
  });

  it("an idle creative focuses as its chip in the idle cluster", () => {
    const { lit } = clusterFocus(["idle"], clusters);
    expect(lit.has("idle>idle")).toBe(true);
    expect(lit.has(clusterFrameId("cl:idle"))).toBe(true);
  });

  it("the SAME entity ids re-map in the inverse view — a focus survives a view switch", () => {
    const inverse = buildClusters(graph, "creative").clusters;
    // `hub` was chips by campaign; by creative it is a header → its cluster.
    const asHeader = clusterFocus(["hub"], inverse);
    expect(asHeader.lit.has(clusterHeaderId("cl:hub"))).toBe(true);
    expect(asHeader.lit.has("hub>A")).toBe(true);
    expect(asHeader.lit.has("hub>B")).toBe(true);
    // …and campaign `A`, a header before, is now every `A` chip.
    const asChips = clusterFocus(["A"], inverse);
    expect(asChips.lit.has("hub>A")).toBe(true);
    expect(asChips.lit.has("onlyA>A")).toBe(true);
    expect(asChips.lit.has("hub>B")).toBe(false);
  });

  it("nothing matched → nothing lit, no first", () => {
    expect(clusterFocus(["ghost"], clusters)).toEqual({ lit: new Set(), first: null });
  });
});

describe("performance lens — parseCanvasLens", () => {
  it("accepts the two lenses; anything else is the platform lens", () => {
    expect(parseCanvasLens("rate")).toBe("rate");
    expect(parseCanvasLens("platform")).toBe("platform");
    expect(parseCanvasLens(null)).toBe("platform");
    expect(parseCanvasLens("roas")).toBe("platform");
    expect(parseCanvasLens("")).toBe("platform");
  });
});

describe("performance lens — pairRate (the system's ONE rating rule, per pairing)", () => {
  const config = {
    default: { minSpend: 500, goodRoas: 4, decentRoas: 2 },
    byPlatform: { tiktok: { minSpend: 100, goodRoas: 3, decentRoas: 1.5 } },
  };
  it("ROAS is revenue ÷ spend of the pair's sums", () => {
    expect(pairRate({ spend: 1000, revenue: 4500, platform: "instagram" }, config)).toEqual({
      roas: 4.5,
      rate: "good",
    });
  });
  it("decent and bad by the thresholds (inclusive lower bounds)", () => {
    expect(pairRate({ spend: 1000, revenue: 2000, platform: "instagram" }, config).rate).toBe("decent");
    expect(pairRate({ spend: 1000, revenue: 4000, platform: "instagram" }, config).rate).toBe("good");
    expect(pairRate({ spend: 1000, revenue: 1999, platform: "instagram" }, config).rate).toBe("bad");
  });
  it("zero revenue on enough spend is BAD, not N/A", () => {
    expect(pairRate({ spend: 800, revenue: 0, platform: "instagram" }, config)).toEqual({
      roas: 0,
      rate: "bad",
    });
  });
  it("below the min spend is N/A — the pair's spend, not the campaign's", () => {
    const r = pairRate({ spend: 499, revenue: 5000, platform: "instagram" }, config);
    expect(r.rate).toBe("na");
    expect(r.roas).toBeCloseTo(10.02, 2); // the ratio is still reported
  });
  it("the campaign platform's override wins over the default", () => {
    // $200 is under the default min ($500) but over TikTok's ($100); 2.5× is
    // "decent" by default but … still decent by TikTok's (≥1.5, <3).
    expect(pairRate({ spend: 200, revenue: 500, platform: "instagram" }, config).rate).toBe("na");
    expect(pairRate({ spend: 200, revenue: 500, platform: "tiktok" }, config).rate).toBe("decent");
    expect(pairRate({ spend: 200, revenue: 640, platform: "tiktok" }, config).rate).toBe("good");
  });
});

describe("performance lens — a chip carries its edge's rate", () => {
  it("buildClusters copies roas/rate from the edge (one source, never re-derived)", () => {
    const graph = {
      campaigns: [camp("c:1", 100)],
      creatives: [cre("k:1", 100)],
      edges: [{ ...edge("c:1", "k:1", 100), roas: 3.1, rate: "decent" as const }],
      truncated: null,
    };
    const { clusters } = buildClusters(graph, "campaign");
    expect(clusters[0]!.chips[0]).toMatchObject({ roas: 3.1, rate: "decent" });
    const byCreative = buildClusters(graph, "creative");
    expect(byCreative.clusters[0]!.chips[0]).toMatchObject({ roas: 3.1, rate: "decent" });
  });
});

describe("click inspector — inspectFor reads the drawn graph", () => {
  const graph = {
    campaigns: [
      camp("c:A", 1000, { name: "Alpha", conversions: 20, revenue: 4000, totalChildren: 4 }),
      camp("c:B", 300, { name: "Beta", totalChildren: 1 }),
    ],
    creatives: [
      cre("k:1", 700, { name: "one", conversions: 10, revenue: 2100 }),
      cre("k:2", 400, { name: "two", conversions: 0, revenue: 0 }),
      cre("k:3", 200, { name: "three" }),
      cre("k:idle", 0, { name: "idle" }),
    ],
    edges: [
      edge("c:A", "k:1", 600, true),
      edge("c:A", "k:2", 300, false), // paused here
      edge("c:A", "k:3", 100, true),
      edge("c:B", "k:1", 100, true),
      edge("c:B", "k:2", 100, true),
    ],
    truncated: null,
  };

  it("a campaign lists its creatives — live first, then spend desc — with shares", () => {
    const r = inspectFor("c:A", graph)!;
    expect(r.pairings.map((p) => p.other.id)).toEqual(["k:1", "k:3", "k:2"]);
    expect(r.pairings[0]!.share).toBeCloseTo(0.6, 10);
    expect(r.pairings[2]!.edge.live).toBe(false);
  });

  it("a creative lists its campaigns, share of the CREATIVE's spend", () => {
    const r = inspectFor("k:1", graph)!;
    expect(r.pairings.map((p) => p.other.id)).toEqual(["c:A", "c:B"]);
    expect(r.pairings.map((p) => p.share)).toEqual([600 / 700, 100 / 700]);
    expect(r.hiddenPairings).toBe(0);
  });

  it("ROAS and CPA come from the node's sums; zero conversions → CPA null", () => {
    const a = inspectFor("c:A", graph)!;
    expect(a.roas).toBe(4);
    expect(a.cpa).toBe(50);
    const two = inspectFor("k:2", graph)!;
    expect(two.roas).toBe(0);
    expect(two.cpa).toBeNull();
  });

  it("a campaign SAYS how many pairings the filters hid (totalChildren − listed)", () => {
    expect(inspectFor("c:A", graph)!.hiddenPairings).toBe(1); // 4 scanned, 3 drawn
    expect(inspectFor("c:B", graph)!.hiddenPairings).toBe(0); // never negative
  });

  it("a creative's list is 'unknown'-partial only when the cap bit", () => {
    const capped = { ...graph, truncated: { shownEdges: 5, totalEdges: 9, idleHidden: 0 } };
    expect(inspectFor("k:1", capped)!.hiddenPairings).toBe("unknown");
    const idleOnly = { ...graph, truncated: { shownEdges: 5, totalEdges: 5, idleHidden: 3 } };
    expect(inspectFor("k:1", idleOnly)!.hiddenPairings).toBe(0);
  });

  it("an idle creative has no pairings and no ratios; an unknown id is null", () => {
    const idle = inspectFor("k:idle", graph)!;
    expect(idle.pairings).toEqual([]);
    expect(idle.roas).toBeNull();
    expect(idle.cpa).toBeNull();
    expect(inspectFor("k:nope", graph)).toBeNull();
  });
});

describe("pattern alerts — the Rate patterns", () => {
  const rated = (
    source: string,
    target: string,
    spend: number,
    rate: "good" | "decent" | "bad" | "na",
    live = true,
  ) => ({ ...edge(source, target, spend, live), rate, roas: null });
  const keyOf = (g: Parameters<typeof canvasInsights>[0], key: string) =>
    canvasInsights(g).find((i) => i.key === key);

  it("UNSCALED WINNER: one campaign, rated Good, still live", () => {
    const g = {
      campaigns: [camp("c:A", 1000, { totalChildren: 3 }), camp("c:B", 500, { totalChildren: 2 })],
      creatives: [cre("k:win", 600), cre("k:paused", 200), cre("k:two", 500)],
      edges: [
        rated("c:A", "k:win", 600, "good"),
        rated("c:A", "k:paused", 200, "good", false), // paused Good pairing ≠ winner
        rated("c:A", "k:two", 200, "good"),
        rated("c:B", "k:two", 300, "good"), // two campaigns ≠ unscaled
      ],
    };
    const hit = keyOf(g, "unscaled-winner")!;
    expect(hit.focusIds).toEqual(["k:win"]);
    expect(hit.label).toBe("1 winner in one campaign only");
  });

  it("LEANS ON ONE: ≥70% of the campaign's TRUE spend, 2+ creatives", () => {
    const g = {
      campaigns: [
        camp("c:lean", 1000, { totalChildren: 2 }),
        camp("c:even", 1000, { totalChildren: 2 }),
        camp("c:solo", 500, { totalChildren: 1 }), // one creative = 100%, not a finding
        camp("c:hidden", 1000, { totalChildren: 3 }), // share vs TRUE spend
      ],
      creatives: [cre("k:1", 0), cre("k:2", 0), cre("k:3", 0), cre("k:4", 0)],
      edges: [
        rated("c:lean", "k:1", 700, "na"),
        rated("c:lean", "k:2", 300, "na"),
        rated("c:even", "k:1", 690, "na"), // 69% ≠ lean
        rated("c:even", "k:2", 310, "na"),
        rated("c:solo", "k:3", 500, "na"),
        rated("c:hidden", "k:4", 700, "na"), // the other 300 were filtered out of the drawing
      ],
    };
    const hit = keyOf(g, "leans-on-one")!;
    expect(hit.focusIds).toEqual(["c:lean", "c:hidden"]);
    expect(hit.label).toBe("2 campaigns lean on one creative");
  });

  it("LOSING EVERYWHERE: Bad in ≥2 campaigns, never Good or Decent, N/A ignored", () => {
    const g = {
      campaigns: [camp("c:A", 0), camp("c:B", 0), camp("c:C", 0)],
      creatives: [cre("k:lose", 0), cre("k:mixed", 0), cre("k:once", 0)],
      edges: [
        rated("c:A", "k:lose", 600, "bad"),
        rated("c:B", "k:lose", 600, "bad"),
        rated("c:C", "k:lose", 50, "na"), // too small to judge — ignored
        rated("c:A", "k:mixed", 600, "bad"),
        rated("c:B", "k:mixed", 600, "bad"),
        rated("c:C", "k:mixed", 600, "decent"), // Decent somewhere ≠ losing everywhere
        rated("c:A", "k:once", 600, "bad"), // one Bad ≠ everywhere
        rated("c:B", "k:once", 50, "na"),
      ],
    };
    const hit = keyOf(g, "losing-everywhere")!;
    expect(hit.focusIds).toEqual(["k:lose"]);
    expect(hit.label).toBe("1 creative losing everywhere");
  });

  it("strip order: problems first, the existing chips keep their places", () => {
    const g = {
      campaigns: [
        camp("c:A", 1000, { totalChildren: 2, liveChildren: 0 }),
        camp("c:B", 1000, { totalChildren: 1, liveChildren: 1 }),
      ],
      creatives: [cre("k:lose", 0), cre("k:win", 0), cre("k:idle", 0)],
      edges: [
        rated("c:A", "k:lose", 900, "bad", false),
        rated("c:B", "k:lose", 600, "bad"),
        rated("c:A", "k:win", 100, "good", false),
        rated("c:B", "k:win", 400, "good"),
      ],
    };
    // k:win is in two campaigns → not a winner; add one that is.
    g.creatives.push(cre("k:w1", 0));
    g.campaigns.push(camp("c:C", 100, { totalChildren: 1, liveChildren: 1 }));
    g.edges.push(rated("c:C", "k:w1", 100, "good"));
    expect(canvasInsights(g).map((i) => i.key)).toEqual([
      "no-live-creatives",
      "idle-active",
      "losing-everywhere",
      "leans-on-one",
      "unscaled-winner",
      "most-shared",
    ]);
  });

  it("nothing rated (every pairing N/A) adds no Rate chip", () => {
    const g = {
      campaigns: [camp("c:A", 1000, { totalChildren: 2 })],
      creatives: [cre("k:1", 0), cre("k:2", 0)],
      edges: [rated("c:A", "k:1", 500, "na"), rated("c:A", "k:2", 500, "na")],
    };
    const keys = canvasInsights(g).map((i) => i.key);
    expect(keys).not.toContain("unscaled-winner");
    expect(keys).not.toContain("losing-everywhere");
  });
});
