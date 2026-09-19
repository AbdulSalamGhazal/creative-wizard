import { describe, expect, it } from "vitest";
import { funnelTotals, type FunnelSumsRow } from "@/lib/funnel-totals";

/**
 * The JS mirror of the SQL ratio guard, used by the pinned totals rows. Two
 * things are pinned here: NULL means "not measured" (it renders as "—", never
 * 0%/NaN%/∞%), and a row that didn't report one side of a ratio contributes to
 * NEITHER side — so it can't inflate the result.
 */
const row = (over: Partial<FunnelSumsRow> = {}): FunnelSumsRow => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  conversionValue: 0,
  landingPageViews: 0,
  addToCart: 0,
  addPayment: 0,
  ...over,
});

describe("funnelTotals", () => {
  it("weights by component sums — never a mean of the rows' ratios", () => {
    const t = funnelTotals([
      row({ impressions: 1000, clicks: 100 }), // 10% CTR
      row({ impressions: 9000, clicks: 180 }), // 2% CTR
    ]);
    // Σclicks / Σimpressions = 280/10000 = 2.8%, NOT the 6% mean of the two.
    expect(t.ctr).toBeCloseTo(0.028, 9);
    expect(t.ctr).not.toBeCloseTo(0.06, 6);
  });

  it("a platform that reported NOTHING for a step leaves it NULL, not 0", () => {
    // The google shape: conversions and clicks, no mid-funnel steps at all.
    const t = funnelTotals([
      row({ clicks: 300, conversions: 90, landingPageViews: null, addToCart: null, addPayment: null }),
    ]);
    expect(t.landingPageViews).toBeNull();
    expect(t.addToCart).toBeNull();
    expect(t.addPayment).toBeNull();
    // …and every rate over a missing side is NULL → the UI renders "—".
    expect(t.voc).toBeNull();
    expect(t.cvr).toBeNull();
    expect(t.atcRate).toBeNull();
    expect(t.apRate).toBeNull();
    expect(t.purchaseRate).toBeNull();
    // Never 0, never NaN, never Infinity.
    for (const v of [t.voc, t.cvr, t.atcRate, t.apRate, t.purchaseRate]) {
      expect(v === 0).toBe(false);
      expect(Number.isNaN(v as number)).toBe(false);
    }
  });

  it("MIXED rows: a row missing a side joins NEITHER side of that ratio", () => {
    const t = funnelTotals([
      // instagram — a full funnel.
      row({
        spend: 100,
        impressions: 1000,
        clicks: 200,
        landingPageViews: 100,
        addToCart: 50,
        addPayment: 40,
        conversions: 10,
        conversionValue: 500,
      }),
      // google — conversions and clicks, nothing mid-funnel.
      row({
        spend: 200,
        impressions: 5000,
        clicks: 300,
        landingPageViews: null,
        addToCart: null,
        addPayment: null,
        conversions: 90,
        conversionValue: 4500,
      }),
    ]);
    // The poisoned readings this guard exists to prevent:
    expect(t.purchaseRate).toBeCloseTo(10 / 40, 9); // NOT (10+90)/40 = 250%
    expect(t.cvr).toBeCloseTo(10 / 100, 9); // NOT (10+90)/100
    expect(t.voc).toBeCloseTo(100 / 200, 9); // NOT 100/(200+300)
    expect(t.atcRate).toBeCloseTo(50 / 100, 9);
    expect(t.apRate).toBeCloseTo(40 / 50, 9);
    // Metrics every platform reports keep BOTH rows.
    expect(t.spend).toBe(300);
    expect(t.conversions).toBe(100);
    expect(t.ctr).toBeCloseTo(500 / 6000, 9);
    expect(t.cpm).toBeCloseTo((300 / 6000) * 1000, 9);
    expect(t.cpa).toBeCloseTo(300 / 100, 9);
    expect(t.roas).toBeCloseTo(5000 / 300, 9);
    // The reported sums are the sums of what WAS reported.
    expect(t.landingPageViews).toBe(100);
  });

  it("a zero denominator is NULL, not a division by zero", () => {
    const t = funnelTotals([row({ conversions: 5, addPayment: 0, landingPageViews: 0 })]);
    expect(t.purchaseRate).toBeNull();
    expect(t.cvr).toBeNull();
    expect(t.ctr).toBeNull();
    expect(t.roas).toBeNull();
    expect(t.cpa).toBeCloseTo(0, 9); // spend 0 over 5 conversions is a real 0.
  });

  it("no rows at all → zeroed sums and every rate NULL", () => {
    const t = funnelTotals([]);
    expect(t.spend).toBe(0);
    expect(t.landingPageViews).toBeNull();
    expect(t.ctr).toBeNull();
    expect(t.cvr).toBeNull();
  });

  it("callers without cart/payment columns still get the LP-view rates", () => {
    // The creative-detail table passes rows with no addToCart/addPayment keys.
    const t = funnelTotals([
      { spend: 50, impressions: 500, clicks: 50, conversions: 5, conversionValue: 250, landingPageViews: 25 },
    ]);
    expect(t.voc).toBeCloseTo(0.5, 9);
    expect(t.cvr).toBeCloseTo(0.2, 9);
    expect(t.atcRate).toBeNull();
    expect(t.addToCart).toBeNull();
  });
});
