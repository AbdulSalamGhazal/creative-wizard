import { describe, expect, it } from "vitest";
import type { ParsedRow } from "@/csv/pipeline";
import { uploadTotals } from "@/csv/upload-totals";

const row = (over: Partial<ParsedRow>): ParsedRow => ({
  rowNumber: 2,
  creativeName: "Hook 01",
  landingCode: null,
  date: "2026-10-01",
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: null,
  conversionValue: null,
  campaignName: "Launch ➤ Broad",
  landingPageViews: null,
  addToCart: null,
  addPayment: null,
  videoViews2s: null,
  videoViews25: null,
  videoViews50: null,
  videoViews75: null,
  videoViews100: null,
  rawPayload: {},
  ...over,
});

describe("uploadTotals", () => {
  it("sums spend, conversions and revenue and counts distinct campaigns", () => {
    const t = uploadTotals([
      row({ spend: 10.5, conversions: 2, conversionValue: 100 }),
      row({ spend: 4.5, conversions: 1, conversionValue: 50, campaignName: "Retarget ➤ All" }),
      row({ spend: 5, conversions: 0, conversionValue: 0 }),
    ]);
    expect(t).toEqual({ spend: 20, conversions: 3, revenue: 150, campaigns: 2 });
  });

  it("keeps an unreported field NULL, not 0", () => {
    const t = uploadTotals([row({ spend: 3 }), row({ spend: 4 })]);
    expect(t.conversions).toBeNull();
    expect(t.revenue).toBeNull();
    expect(t.spend).toBe(7);
  });

  it("is empty for no rows", () => {
    expect(uploadTotals([])).toEqual({ spend: 0, conversions: null, revenue: null, campaigns: 0 });
  });
});
