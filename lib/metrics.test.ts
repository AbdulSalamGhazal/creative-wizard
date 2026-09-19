import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  aov,
  apRate,
  atcRate,
  completeRate,
  cpa,
  cpc,
  cpm,
  ctr,
  cvr,
  holdRate,
  hookRate,
  roas,
  sumAddPayment,
  sumAddToCart,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
  sumVideoViews100,
  sumVideoViews25,
  sumVideoViews2s,
  sumVideoViews50,
  sumVideoViews75,
  voc,
  platformMetrics,
  purchaseRate,
} from "@/lib/metrics";
import { unavailableFieldsFor } from "@/csv/platforms/types";

/**
 * lib/metrics.ts is the single source of truth for the project's CRITICAL
 * aggregation rule: every blended metric is a weighted average via component
 * sums — SUM(numerator) / NULLIF(SUM(denominator), 0) — never AVG(per-row
 * ratio), and never a bare divisor that can produce division-by-zero.
 * These tests pin that shape for every fragment.
 */
const render = (fragment: SQL): string =>
  new PgDialect().sqlToQuery(fragment).sql;
/** Rendered SQL with the bound values inlined — readable for shape assertions. */
const renderFull = (fragment: SQL): string => {
  const q = new PgDialect().sqlToQuery(fragment);
  return q.sql.replace(/\$(\d+)/g, (_m, i) => `'${String(q.params[Number(i) - 1])}'`);
};

const RATIOS: Array<{
  name: string;
  fragment: SQL<number>;
  numerator: string;
  denominator: string;
}> = [
  { name: "ctr", fragment: ctr, numerator: "clicks", denominator: "impressions" },
  { name: "cpm", fragment: cpm, numerator: "spend", denominator: "impressions" },
  { name: "cpc", fragment: cpc, numerator: "spend", denominator: "clicks" },
  { name: "cpa", fragment: cpa, numerator: "spend", denominator: "conversions" },
  { name: "roas", fragment: roas, numerator: "conversion_value", denominator: "spend" },
  { name: "aov", fragment: aov, numerator: "conversion_value", denominator: "conversions" },
  { name: "voc", fragment: voc, numerator: "landing_page_views", denominator: "clicks" },
  { name: "cvr", fragment: cvr, numerator: "conversions", denominator: "landing_page_views" },
  { name: "atcRate", fragment: atcRate, numerator: "add_to_cart", denominator: "landing_page_views" },
  { name: "apRate", fragment: apRate, numerator: "add_payment", denominator: "add_to_cart" },
  { name: "purchaseRate-like hookRate", fragment: hookRate, numerator: "video_views_2s", denominator: "impressions" },
  { name: "holdRate", fragment: holdRate, numerator: "video_views_50", denominator: "video_views_2s" },
  { name: "completeRate", fragment: completeRate, numerator: "video_views_100", denominator: "video_views_2s" },
];

const SUMS: Array<{ name: string; fragment: SQL<number>; column: string }> = [
  { name: "sumSpend", fragment: sumSpend, column: "spend" },
  { name: "sumImpressions", fragment: sumImpressions, column: "impressions" },
  { name: "sumClicks", fragment: sumClicks, column: "clicks" },
  { name: "sumConversions", fragment: sumConversions, column: "conversions" },
  { name: "sumConversionValue", fragment: sumConversionValue, column: "conversion_value" },
  { name: "sumLandingPageViews", fragment: sumLandingPageViews, column: "landing_page_views" },
  { name: "sumAddToCart", fragment: sumAddToCart, column: "add_to_cart" },
  { name: "sumAddPayment", fragment: sumAddPayment, column: "add_payment" },
  { name: "sumVideoViews2s", fragment: sumVideoViews2s, column: "video_views_2s" },
  { name: "sumVideoViews25", fragment: sumVideoViews25, column: "video_views_25" },
  { name: "sumVideoViews50", fragment: sumVideoViews50, column: "video_views_50" },
  { name: "sumVideoViews75", fragment: sumVideoViews75, column: "video_views_75" },
  { name: "sumVideoViews100", fragment: sumVideoViews100, column: "video_views_100" },
];

describe("lib/metrics fragments — weighted-average shape (CRITICAL rule)", () => {
  it.each(RATIOS)(
    "$name divides SUM($numerator) by NULLIF(SUM($denominator), 0)",
    ({ fragment, numerator, denominator }) => {
      const text = render(fragment);
      // Numerator: a SUM over the expected column appears before the division.
      const [num, den] = text.split("/");
      expect(num).toMatch(new RegExp(`SUM\\(.*"${numerator}"`));
      // Denominator: NULLIF(SUM(<col>) ..., 0) — division by zero → NULL → "—".
      expect(den).toContain("NULLIF(");
      expect(den).toMatch(new RegExp(`SUM\\(.*"${denominator}"`));
      expect(den).toMatch(/,\s*0\)/);
    },
  );

  it.each(SUMS)("$name is a plain SUM over $column", ({ fragment, column }) => {
    const text = render(fragment);
    expect(text).toMatch(new RegExp(`^SUM\\(.*"${column}"\\)$`));
  });

  it("no fragment ever uses AVG (mean of per-row ratios is forbidden)", () => {
    for (const { fragment } of [...RATIOS, ...SUMS]) {
      expect(render(fragment)).not.toMatch(/\bAVG\s*\(/i);
    }
  });

  it("hookRate restricts its impressions denominator to video rows", () => {
    // Non-video impressions must not dilute the video hook rate.
    expect(render(hookRate)).toMatch(
      /FILTER \(WHERE .*"video_views_2s" IS NOT NULL\)/,
    );
  });

  it("cpm scales the ratio to cost-per-thousand", () => {
    expect(render(cpm)).toMatch(/\* 1000$/);
  });
});

/**
 * The ratio-poisoning guard. Google's exports carry no landing-page views, no
 * cart/payment events and no video funnel, so its rows store NULL there — and
 * SUM skips NULLs. Without the guard a blended ratio would take its numerator
 * from every platform and its denominator from only some.
 */
describe("google ratio guard", () => {
  const GUARDED: Array<{ name: string; fragment: SQL<number> }> = [
    { name: "voc", fragment: voc },
    { name: "cvr", fragment: cvr },
    { name: "atcRate", fragment: atcRate },
    { name: "apRate", fragment: apRate },
    { name: "purchaseRate", fragment: purchaseRate },
    { name: "hookRate", fragment: hookRate },
    { name: "holdRate", fragment: holdRate },
    { name: "completeRate", fragment: completeRate },
  ];
  // Ratios google reports in full — it must stay IN these.
  const UNGUARDED: Array<{ name: string; fragment: SQL<number> }> = [
    { name: "ctr", fragment: ctr },
    { name: "cpm", fragment: cpm },
    { name: "cpc", fragment: cpc },
    { name: "cpa", fragment: cpa },
    { name: "roas", fragment: roas },
    { name: "aov", fragment: aov },
  ];

  const EXCLUDES_GOOGLE = /"platform" not in \('google'\)/i;

  it.each(GUARDED)(
    "$name excludes google from BOTH sides of the division",
    ({ fragment }) => {
      const [num, den] = renderFull(fragment).split("/");
      expect(num).toMatch(EXCLUDES_GOOGLE);
      expect(den).toMatch(EXCLUDES_GOOGLE);
    },
  );

  it.each(UNGUARDED)("$name keeps google in — it reports every input", ({ fragment }) => {
    expect(renderFull(fragment)).not.toMatch(EXCLUDES_GOOGLE);
  });

  it.each(SUMS)("$name is never guarded — a total includes every platform", ({ fragment }) => {
    expect(renderFull(fragment)).not.toMatch(EXCLUDES_GOOGLE);
  });

  it("guards the per-platform FILTER block too, on both sides", () => {
    const block = platformMetrics("tiktok");
    for (const key of ["voc", "cvr", "holdRate", "completeRate"] as const) {
      const [num, den] = renderFull(block[key]).split("/");
      expect(num).toMatch(EXCLUDES_GOOGLE);
      expect(den).toMatch(EXCLUDES_GOOGLE);
    }
    // …and leaves the block's plain component sums alone.
    expect(renderFull(block.landingPageViews)).not.toMatch(EXCLUDES_GOOGLE);
    expect(renderFull(block.ctr)).not.toMatch(EXCLUDES_GOOGLE);
  });

  it("a google-scoped block yields NULL for the rates it can't support", () => {
    // Both sides filter to platform = 'google' AND platform NOT IN ('google')
    // → no rows → SUM is NULL → NULLIF → NULL → the UI renders an em-dash,
    // never a 0% that would read as a real measurement.
    const text = renderFull(platformMetrics("google").cvr);
    expect(text).toMatch(/"platform" = 'google'/i);
    expect(text).toMatch(EXCLUDES_GOOGLE);
  });

  it("the guard DERIVES from the field declaration, not a hand-list", () => {
    // If google ever gains landing-page views, dropping `unavailableOn` is the
    // only edit needed — this test documents the coupling.
    expect(unavailableFieldsFor("google")).toContain("landing_page_views");
    expect(unavailableFieldsFor("google")).toContain("add_payment");
    expect(unavailableFieldsFor("instagram")).toEqual([]);
  });
});
