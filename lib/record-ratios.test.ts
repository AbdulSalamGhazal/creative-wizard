import { describe, expect, it } from "vitest";
import { recordRatios } from "@/lib/record-ratios";

describe("recordRatios — one row's own ratios", () => {
  it("derives CTR, CPM, CPA and ROAS from the row's components", () => {
    const r = recordRatios({
      spend: 100,
      impressions: 20000,
      clicks: 400,
      conversions: 4,
      conversionValue: 350,
    });
    expect(r.ctr).toBeCloseTo(0.02);
    expect(r.cpm).toBeCloseTo(5);
    expect(r.cpa).toBeCloseTo(25);
    expect(r.roas).toBeCloseTo(3.5);
  });

  it("a zero denominator is NULL, never Infinity or NaN", () => {
    const r = recordRatios({
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionValue: 0,
    });
    expect(r).toEqual({ ctr: null, cpm: null, cpa: null, roas: null });
  });

  it("an unreported conversion count or value stays NULL (NULL ≠ 0)", () => {
    const r = recordRatios({
      spend: 50,
      impressions: 1000,
      clicks: 10,
      conversions: null,
      conversionValue: null,
    });
    expect(r.cpa).toBeNull();
    expect(r.roas).toBeNull();
    expect(r.ctr).toBeCloseTo(0.01);
  });

  it("a REPORTED zero value is a real 0× ROAS", () => {
    const r = recordRatios({
      spend: 50,
      impressions: 1000,
      clicks: 10,
      conversions: 0,
      conversionValue: 0,
    });
    expect(r.roas).toBe(0);
    expect(r.cpa).toBeNull();
  });
});
