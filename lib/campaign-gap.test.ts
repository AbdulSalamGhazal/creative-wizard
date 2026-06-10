import { describe, expect, it } from "vitest";
import { campaignGap, type GapCreative } from "./campaign-gap";

const c = (id: string, spend: number, rev: number): GapCreative => ({
  id,
  name: id,
  spend,
  rev,
});

describe("campaignGap", () => {
  it("floorMissed ≤ ceilMissed, both ≥ 0", () => {
    const gap = campaignGap([
      c("win", 1000, 4000), // ROAS 4
      c("mid", 1000, 2000), // ROAS 2
      c("lose", 1000, 500), // ROAS 0.5
    ]);
    expect(gap.floorMissed).toBeGreaterThanOrEqual(0);
    expect(gap.ceilMissed).toBeGreaterThanOrEqual(0);
    expect(gap.floorMissed).toBeLessThanOrEqual(gap.ceilMissed);
    expect(gap.topQ).toBeGreaterThanOrEqual(gap.campaignAvg);
  });

  it("all-winners campaign ⇒ floorMissed = 0", () => {
    const gap = campaignGap([
      c("a", 500, 1000),
      c("b", 500, 1000),
    ]);
    expect(gap.loserCount).toBe(0);
    expect(gap.floorMissed).toBe(0);
    expect(gap.ceilMissed).toBe(0);
  });

  it("flags low-confidence creatives and keeps them out of topQ", () => {
    const gap = campaignGap([
      c("big", 2000, 4000), // ROAS 2
      c("tiny", 50, 1000), // ROAS 20 but only $50 → low-confidence
      c("lose", 1000, 200), // ROAS 0.2
    ]);
    const tiny = gap.rows.find((r) => r.id === "tiny")!;
    expect(tiny.lowConfidence).toBe(true);
    // topQ should reflect "big" (the real best), not the lucky tiny creative.
    expect(gap.topQ).toBeLessThan(20);
    expect(gap.topQ).toBeGreaterThanOrEqual(gap.campaignAvg);
  });

  it("identifies losers relative to the campaign average", () => {
    const gap = campaignGap([c("a", 1000, 3000), c("b", 1000, 1000)]);
    // campaignAvg = 4000/2000 = 2. a (3) is a winner, b (1) is a loser.
    expect(gap.campaignAvg).toBeCloseTo(2, 9);
    expect(gap.loserCount).toBe(1);
    expect(gap.rows.find((r) => r.id === "b")!.isLoser).toBe(true);
  });
});
