import { describe, expect, it } from "vitest";
import { isoDaysBetween } from "@/lib/budget";
import { buildRangeModel } from "@/lib/budget-range";
import { buildResultRows } from "@/lib/budget-results";

const FROM = "2026-10-01";
const TO = "2026-10-10";
const day = (platform: string, objective: "Awareness" | "Retargeting", spend: number, purchases: number | null, value: number | null) =>
  isoDaysBetween(FROM, TO).map((date) => ({ date, platform, objective, spend, purchases, purchaseValue: value }));

const model = buildRangeModel({
  from: FROM,
  to: TO,
  series: {
    spend: [
      ...day("instagram", "Awareness", 60, 2, 120),
      ...day("instagram", "Retargeting", 40, 3, 280),
      ...day("tiktok", "Awareness", 100, 5, 300),
      // Google reports no purchases here.
      ...day("google", "Awareness", 50, null, null),
    ],
    days: [],
  },
  plans: [],
  rate: 3.75,
  platforms: [],
  coverage: { instagram: TO, tiktok: TO, google: TO },
  storeHorizon: null,
  today: TO,
});
const label = (p: string) => p;

describe("buildResultRows — the results lens", () => {
  it("by platform: ratios from sums, shares over the reporting platforms only", () => {
    const rows = buildResultRows({ dimension: "platform", board: model.board, platformLabel: label });
    expect(rows.map((r) => r.key)).toEqual(["instagram", "tiktok", "google"]);
    const ig = rows[0]!;
    // 1,000 spent, 50 purchases worth 4,000.
    expect(ig).toMatchObject({ spend: 1000, platform: "instagram" });
    expect(ig.results).toMatchObject({ purchases: 50, roas: 4, cpa: 20 });
    // Shares over instagram + tiktok (2,000 spend, 100 purchases): 50% / 50%.
    expect(ig.spendShare).toBeCloseTo(0.5, 6);
    expect(ig.purchaseShare).toBeCloseTo(0.5, 6);
    // Google doesn't report purchases: listed, with no share and no zero.
    expect(rows[2]).toMatchObject({ spendShare: null, purchaseShare: null, gapPts: null });
    expect(rows[2]!.results.purchases).toBeNull();
  });

  it("by objective: a non-reporting part leaves BOTH sides of the ratio and of the share", () => {
    const rows = buildResultRows({ dimension: "objective", board: model.board, platformLabel: label });
    const awareness = rows.find((r) => r.key === "Awareness")!;
    // All three platforms' awareness spend…
    expect(awareness.spend).toBe(2100);
    // …but CPA divides only the reporting 1,600 by the 70 purchases.
    expect(awareness.results.purchases).toBe(70);
    expect(awareness.results.cpa).toBeCloseTo(22.86, 2);
    // Shares: reporting spend 1,600 of 2,000; purchases 70 of 100.
    expect(awareness.spendShare).toBeCloseTo(0.8, 6);
    expect(awareness.purchaseShare).toBeCloseTo(0.7, 6);
    expect(awareness.gapPts).toBeCloseTo(-10, 6);
    expect(rows.find((r) => r.key === "Activation")).toBeUndefined();
  });

  it("by product: the product scan folded across in-scope platforms", () => {
    const products = [
      { platform: "instagram", productId: "p1", productName: "Oud", spend: 600, purchases: 30, purchaseValue: 2400 },
      { platform: "tiktok", productId: "p1", productName: "Oud", spend: 400, purchases: 10, purchaseValue: 600 },
      { platform: "tiktok", productId: "p2", productName: "Musk", spend: 500, purchases: 40, purchaseValue: 1500 },
      { platform: "google", productId: "p2", productName: "Musk", spend: 300, purchases: null, purchaseValue: null },
    ];
    const rows = buildResultRows({ dimension: "product", board: model.board, products, platformLabel: label });
    expect(rows.map((r) => [r.label, r.spend])).toEqual([["Oud", 1000], ["Musk", 800]]);
    expect(rows[0]!.results).toMatchObject({ purchases: 40, roas: 3, cpa: 25 });
    // Musk: ROAS and CPA over TikTok's 500 only.
    expect(rows[1]!.results).toMatchObject({ purchases: 40, roas: 3, cpa: 12.5 });
    // The platform filter scopes it.
    const tiktokOnly = buildResultRows({
      dimension: "product",
      board: model.board,
      products,
      inScope: (p) => p === "tiktok",
      platformLabel: label,
    });
    expect(tiktokOnly.map((r) => [r.label, r.spend])).toEqual([["Musk", 500], ["Oud", 400]]);
  });
});
