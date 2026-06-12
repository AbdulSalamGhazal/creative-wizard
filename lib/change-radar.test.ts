import { describe, expect, it } from "vitest";
import {
  assessChange,
  deriveChangeMetrics,
  type ChangeWindowBlock,
} from "@/lib/change-radar";

function block(partial: Partial<ChangeWindowBlock>): ChangeWindowBlock {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    landingPageViews: 0,
    ...partial,
  };
}

describe("deriveChangeMetrics", () => {
  it("recombines ratios from component sums (weighted, not averaged)", () => {
    const cur = block({
      spend: 1000,
      impressions: 100_000,
      clicks: 2000,
      conversions: 100,
      conversionValue: 4000,
      landingPageViews: 1600,
    });
    const prev = block({
      spend: 500,
      impressions: 40_000,
      clicks: 1000,
      conversions: 50,
      conversionValue: 4000,
      landingPageViews: 900,
    });
    const m = Object.fromEntries(
      deriveChangeMetrics(cur, prev).map((x) => [x.key, x]),
    );
    expect(m.roas!.cur).toBeCloseTo(4); // 4000/1000
    expect(m.roas!.prev).toBeCloseTo(8); // 4000/500
    expect(m.roas!.change).toBeCloseTo(-0.5);
    expect(m.roas!.deterioration).toBeCloseTo(0.5); // higher-is-better, halved
    expect(m.cpa!.cur).toBeCloseTo(10);
    expect(m.cpa!.prev).toBeCloseTo(10);
    expect(m.cpa!.deterioration).toBeCloseTo(0); // unchanged
    expect(m.ctr!.cur).toBeCloseTo(0.02);
  });

  it("spend carries a change but never a deterioration", () => {
    const m = deriveChangeMetrics(
      block({ spend: 200 }),
      block({ spend: 400 }),
    ).find((x) => x.key === "spend")!;
    expect(m.change).toBeCloseTo(-0.5);
    expect(m.deterioration).toBeNull();
  });

  it("returns null deltas when the previous side is undefined", () => {
    const m = deriveChangeMetrics(
      block({ spend: 500, conversionValue: 1000 }),
      block({}),
    ).find((x) => x.key === "roas")!;
    expect(m.cur).toBeCloseTo(2);
    expect(m.prev).toBeNull();
    expect(m.change).toBeNull();
    expect(m.deterioration).toBeNull();
  });
});

describe("assessChange tiers", () => {
  const healthy = (spend: number) =>
    block({
      spend,
      impressions: spend * 100,
      clicks: spend * 2,
      conversions: spend / 10,
      conversionValue: spend * 8,
      landingPageViews: spend * 1.5,
    });

  it("flags a ≥50% ROAS collapse as drop and names the worst metric", () => {
    const prev = healthy(1000); // roas 8
    const cur = { ...healthy(1000), conversionValue: 3000 }; // roas 3 → −62.5%
    const a = assessChange(cur, prev);
    expect(a.tier).toBe("drop");
    expect(a.worst?.key).toBe("roas");
    expect(a.worst?.deterioration).toBeCloseTo(0.625);
  });

  it("flags a 25–50% deterioration as watch (CPA rising)", () => {
    const prev = healthy(1000); // cpa 10
    const cur = { ...healthy(1000), conversions: 75 }; // cpa 13.33 → +33%
    expect(assessChange(cur, prev).tier).toBe("watch");
  });

  it("stays stable under the watch threshold", () => {
    const prev = healthy(1000);
    const cur = { ...healthy(1000), conversionValue: 7000 }; // roas −12.5%
    expect(assessChange(cur, prev).tier).toBe("stable");
  });

  it("never warns below the spend floor, however wild the swing", () => {
    const prev = healthy(100); // both windows under $150
    const cur = { ...healthy(100), conversionValue: 5 };
    expect(assessChange(cur, prev).tier).toBe("low");
  });

  it("classifies entered/exited entities as new/gone", () => {
    expect(assessChange(healthy(500), block({})).tier).toBe("new");
    expect(assessChange(block({}), healthy(500)).tier).toBe("gone");
  });
});
