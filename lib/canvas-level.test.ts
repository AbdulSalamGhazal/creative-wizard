import { describe, expect, it } from "vitest";
import {
  canvasFocusHref,
  canvasInsights,
  canvasLevelNoun,
  canvasPairs,
  canvasViewLabel,
  focusLevel,
  pairVerdict,
  parseCanvasFocus,
  parseCanvasLevel,
  type CanvasCampaignNode,
  type CanvasCreativeNode,
  type CanvasEdge,
  type CanvasScanRow,
} from "@/lib/canvas";

/**
 * THE LEVEL SWITCH (2026-11): the campaign side of the Canvas is ad sets or
 * campaigns. The scan is one row per (ad set, creative) at both levels; these
 * pin the FOLD and the verdicts a folded pairing gets.
 */

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const row = (over: Partial<CanvasScanRow>): CanvasScanRow => ({
  campaignId: "as1",
  campaignName: "Ramadan ➤ Broad (IG)",
  objective: "Sales",
  campaignPlatform: "instagram",
  parentId: P1,
  parentName: "Ramadan",
  parentNetwork: "meta",
  creativeId: "k1",
  spend: 100,
  conversions: 2,
  revenue: 400,
  lastSpendDay: "2026-09-19",
  firstSpendDay: "2026-09-10",
  ...over,
});

describe("?level= and the campaign's node id", () => {
  it("anything unknown is ad sets — the clean URL", () => {
    expect(parseCanvasLevel(undefined)).toBe("adset");
    expect(parseCanvasLevel("")).toBe("adset");
    expect(parseCanvasLevel("parent")).toBe("adset");
    expect(parseCanvasLevel("campaign")).toBe("campaign");
  });

  it("p:<uuid> is a campaign, c:<uuid> stays the ad set", () => {
    expect(parseCanvasFocus(`p:${P1}`)).toEqual({ kind: "parent_campaign", id: P1, nodeId: `p:${P1}` });
    expect(parseCanvasFocus(`c:${P1}`)).toEqual({ kind: "campaign", id: P1, nodeId: `c:${P1}` });
    expect(parseCanvasFocus(`x:${P1}`)).toBeNull();
  });

  it("each focus kind names the level it is drawn at", () => {
    expect(focusLevel("campaign")).toBe("adset");
    expect(focusLevel("parent_campaign")).toBe("campaign");
    expect(focusLevel("creative")).toBeNull();
  });

  it("a campaign's way in carries its level; an ad set's link is unchanged", () => {
    const range = { from: "2026-09-01", to: "2026-09-30" };
    const parent = new URL(canvasFocusHref({ parentCampaignId: P1 }, range), "https://x");
    expect(parent.searchParams.get("level")).toBe("campaign");
    expect(parent.searchParams.get("focus")).toBe(`p:${P1}`);
    const adSet = new URL(canvasFocusHref({ campaignId: P1 }, range), "https://x");
    expect(adSet.searchParams.get("level")).toBeNull();
    expect(adSet.searchParams.get("focus")).toBe(`c:${P1}`);
  });

  it("the second view is named after the level", () => {
    expect(canvasViewLabel("campaign", "adset")).toBe("By ad set");
    expect(canvasViewLabel("campaign", "campaign")).toBe("By campaign");
    expect(canvasViewLabel("creative", "campaign")).toBe("By creative");
  });
});

describe("canvasPairs — the scan folded to a level", () => {
  const rows = [
    row({}),
    // The SAME creative in the campaign's Facebook ad set, and in a second IG one.
    row({ campaignId: "as2", campaignName: "Ramadan ➤ Broad (FB)", campaignPlatform: "facebook", spend: 300, conversions: 3, revenue: 600, lastSpendDay: "2026-09-12", firstSpendDay: "2026-09-08" }),
    row({ campaignId: "as3", campaignName: "Ramadan ➤ Lookalike (IG)", objective: "Prospecting", spend: 50, conversions: 1, revenue: 50, lastSpendDay: "2026-09-15", firstSpendDay: "2026-09-12" }),
    // Another creative, another campaign.
    row({ campaignId: "as4", campaignName: "Always On ➤ All", campaignPlatform: "tiktok", parentId: P2, parentName: "Always On", parentNetwork: "tiktok", creativeId: "k2", spend: 80, conversions: 0, revenue: 0 }),
  ];

  it("ad-set level is one pairing per row", () => {
    const pairs = canvasPairs(rows, "adset");
    expect(pairs).toHaveLength(4);
    expect(pairs.map((p) => p.sideId)).toEqual(["c:as1", "c:as2", "c:as3", "c:as4"]);
    expect(pairs[0]).toMatchObject({ rowId: "as1", name: "Ramadan ➤ Broad (IG)", parentId: P1, spend: 100 });
    expect(pairs[0]!.byPlatform).toEqual([
      { platform: "instagram", spend: 100, revenue: 400, lastSpendDay: "2026-09-19" },
    ]);
  });

  it("campaign level folds a campaign's ad sets per creative — component sums, counted once", () => {
    const pairs = canvasPairs(rows, "campaign");
    expect(pairs).toHaveLength(2);
    const ramadan = pairs.find((p) => p.sideId === `p:${P1}`)!;
    expect(ramadan).toMatchObject({
      rowId: P1,
      name: "Ramadan",
      network: "meta",
      creativeId: "k1",
      spend: 450,
      conversions: 6,
      revenue: 1050,
      // The earliest first-spend day of its ad sets.
      firstSpendDay: "2026-09-08",
    });
    expect(ramadan.adSetIds).toEqual(["as1", "as2", "as3"]);
    expect(ramadan.objectives).toEqual(["Sales", "Prospecting"]);
  });

  it("keeps the per-platform slices apart, biggest spender first", () => {
    const ramadan = canvasPairs(rows, "campaign").find((p) => p.sideId === `p:${P1}`)!;
    expect(ramadan.byPlatform).toEqual([
      { platform: "facebook", spend: 300, revenue: 600, lastSpendDay: "2026-09-12" },
      // Two Instagram ad sets: summed, and the LATER last-spend day.
      { platform: "instagram", spend: 150, revenue: 450, lastSpendDay: "2026-09-19" },
    ]);
  });

  it("an ad set with no campaign yet has no campaign-level pairing", () => {
    const orphan = row({ campaignId: "as9", parentId: null, parentName: null, parentNetwork: null, creativeId: "k9" });
    expect(canvasPairs([orphan], "campaign")).toEqual([]);
    // …but still draws at ad-set level, its network read off its platform.
    expect(canvasPairs([orphan], "adset")[0]).toMatchObject({ sideId: "c:as9", network: "meta", parentId: null });
  });
});

describe("pairVerdict — both clocks and the Rate, per platform", () => {
  const ratingConfig = {
    default: { minSpend: 400, goodRoas: 4, decentRoas: 2 },
    byPlatform: { facebook: { minSpend: 100, goodRoas: 3, decentRoas: 1.5 } },
  };
  // A 1-day window: only a pair that spent ON its platform's latest day is live.
  const ctx = {
    freshness: { instagram: "2026-09-19", facebook: "2026-09-19", tiktok: "2026-09-10" },
    windowDays: 1,
    ratingConfig,
  };

  it("live when live on ANY platform — each against its own latest day", () => {
    const v = pairVerdict(
      {
        spend: 450,
        revenue: 1050,
        byPlatform: [
          { platform: "facebook", spend: 300, revenue: 600, lastSpendDay: "2026-09-12" },
          { platform: "instagram", spend: 150, revenue: 450, lastSpendDay: "2026-09-19" },
        ],
      },
      ctx,
    );
    expect(v.live).toBe(true);
    expect(v.lastSpendDay).toBe("2026-09-19");
    // Coloured by the platform that spent most in the pairing; both named.
    expect(v.platform).toBe("facebook");
    expect(v.platforms).toEqual(["facebook", "instagram"]);
  });

  it("paused when it stopped on every platform", () => {
    const v = pairVerdict(
      {
        spend: 450,
        revenue: 1050,
        byPlatform: [
          { platform: "facebook", spend: 300, revenue: 600, lastSpendDay: "2026-09-12" },
          { platform: "instagram", spend: 150, revenue: 450, lastSpendDay: "2026-09-15" },
        ],
      },
      ctx,
    );
    expect(v.live).toBe(false);
    expect(v.lastSpendDay).toBe("2026-09-15");
  });

  it("a platform's own clock: TikTok's latest day is older, so its pair is live", () => {
    const v = pairVerdict(
      { spend: 80, revenue: 0, byPlatform: [{ platform: "tiktok", spend: 80, revenue: 0, lastSpendDay: "2026-09-10" }] },
      ctx,
    );
    expect(v.live).toBe(true);
  });

  it("Rate: one platform → its rules; two → the brand default", () => {
    // $300 at 3× on Facebook alone: Good by Facebook's rules.
    const one = pairVerdict(
      { spend: 300, revenue: 900, byPlatform: [{ platform: "facebook", spend: 300, revenue: 900, lastSpendDay: null }] },
      ctx,
    );
    expect(one).toMatchObject({ roas: 3, rate: "good" });
    // The same money split over two platforms: the default rules, whose min
    // spend ($400) it doesn't reach — N/A, never Facebook's verdict.
    const two = pairVerdict(
      {
        spend: 300,
        revenue: 900,
        byPlatform: [
          { platform: "facebook", spend: 200, revenue: 600, lastSpendDay: null },
          { platform: "instagram", spend: 100, revenue: 300, lastSpendDay: null },
        ],
      },
      ctx,
    );
    expect(two).toMatchObject({ roas: 3, rate: "na" });
  });

  it("ROAS is Σrevenue ÷ Σspend over the pairing — never a mean of the slices", () => {
    const v = pairVerdict(
      {
        spend: 1000,
        revenue: 2500,
        byPlatform: [
          { platform: "facebook", spend: 900, revenue: 1800, lastSpendDay: null }, // 2×
          { platform: "instagram", spend: 100, revenue: 700, lastSpendDay: null }, // 7×
        ],
      },
      ctx,
    );
    expect(v.roas).toBe(2.5);
    expect(v.rate).toBe("decent");
  });
});

describe("the insight strip says the level's own word", () => {
  const camp = (id: string, over: Partial<CanvasCampaignNode> = {}): CanvasCampaignNode => ({
    kind: "campaign",
    level: "campaign",
    id,
    campaignId: id,
    name: id,
    objective: "Sales",
    platform: "instagram",
    platforms: ["instagram"],
    network: "meta",
    parentId: id,
    adSets: 2,
    status: "active",
    spend: 1000,
    conversions: 0,
    revenue: 0,
    liveChildren: 0,
    totalChildren: 2,
    launchedOn: null,
    ...over,
  });
  const cre = (id: string): CanvasCreativeNode => ({
    kind: "creative",
    id,
    creativeId: id,
    name: id,
    type: "video",
    status: "pause",
    priority: null,
    stages: [],
    thumbnailUrl: null,
    spend: 500,
    conversions: 0,
    revenue: 0,
    launchedOn: null,
    angles: [],
    roas: null,
    rate: "na",
  });
  const edge = (source: string, target: string, spend: number): CanvasEdge => ({
    id: `${source}|${target}`,
    source,
    target,
    platform: "instagram",
    platforms: ["instagram"],
    spend,
    lastSpendDay: "2026-09-01",
    live: false,
    roas: null,
    rate: "na",
  });
  const graph = {
    campaigns: [camp("p:1"), camp("p:2")],
    creatives: [cre("k:a"), cre("k:b")],
    edges: [edge("p:1", "k:a", 900), edge("p:1", "k:b", 100), edge("p:2", "k:a", 500), edge("p:2", "k:b", 500)],
  };

  it("campaign level: campaigns", () => {
    const labels = canvasInsights({ ...graph, level: "campaign" }).map((i) => i.label);
    expect(labels).toContain("2 campaigns with no live creatives");
    expect(labels).toContain("1 campaign leans on one creative");
    expect(labels).toContain("Most shared: «k:a» feeds 2 campaigns");
  });

  it("ad-set level (and a graph that names none): ad sets, as before", () => {
    for (const level of ["adset", undefined] as const) {
      const labels = canvasInsights({ ...graph, level }).map((i) => i.label);
      expect(labels).toContain("2 ad sets with no live creatives");
      expect(labels).toContain("1 ad set leans on one creative");
      expect(labels).toContain("Most shared: «k:a» feeds 2 ad sets");
    }
  });

  it("canvasLevelNoun pluralises", () => {
    expect(canvasLevelNoun("campaign")).toBe("campaign");
    expect(canvasLevelNoun("campaign", 3)).toBe("campaigns");
    expect(canvasLevelNoun("adset", 1)).toBe("ad set");
    expect(canvasLevelNoun(undefined, 0)).toBe("ad sets");
  });
});
