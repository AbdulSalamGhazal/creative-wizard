/**
 * The JS mirror of `lib/metrics.ts` — the same weighted-average rule, applied
 * where a component recombines rows the server already summed (the /funnel
 * campaign table's pinned totals row).
 *
 * Two rules, both deliberate:
 *
 * 1. **Weighted via component sums, never a mean of per-row ratios** — the
 *    house aggregation rule.
 * 2. **NULL is "not measured", not zero.** A platform that doesn't report a
 *    funnel step stores NULL there (google, per `FIELD_META.unavailableOn`), so
 *    a row only contributes to a ratio when it reports BOTH sides. That is the
 *    JS form of the SQL ratio guard: it can't take a numerator from rows whose
 *    denominator is missing. When no row reports a side, the ratio is NULL and
 *    the UI renders "—" — never 0%, NaN% or ∞%.
 */

export interface FunnelSumsRow {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  /** Mid-funnel steps: NULL when the platform never reported them. Cart and
   *  payment are OPTIONAL so a caller carrying only LP views (the creative
   *  detail table) can share this one implementation of the rule. */
  landingPageViews: number | null;
  addToCart?: number | null;
  addPayment?: number | null;
}

export interface FunnelTotalsResult {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number | null;
  addToCart: number | null;
  addPayment: number | null;
  cpm: number | null;
  cpa: number | null;
  ctr: number | null;
  voc: number | null;
  atcRate: number | null;
  apRate: number | null;
  purchaseRate: number | null;
  cvr: number | null;
  roas: number | null;
}

/** Sum of the reported values; NULL when nothing reported this field at all. */
function sumReported(
  rows: readonly FunnelSumsRow[],
  pick: (r: FunnelSumsRow) => number | null,
): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) continue;
    total += v;
    any = true;
  }
  return any ? total : null;
}

/**
 * Σnumerator ÷ Σdenominator over the rows that report BOTH — the guard. A row
 * missing either side contributes to neither, so it can't inflate the result.
 */
function ratio(
  rows: readonly FunnelSumsRow[],
  num: (r: FunnelSumsRow) => number | null,
  den: (r: FunnelSumsRow) => number | null,
): number | null {
  let n = 0;
  let d = 0;
  let any = false;
  for (const r of rows) {
    const a = num(r);
    const b = den(r);
    if (a === null || b === null) continue;
    n += a;
    d += b;
    any = true;
  }
  if (!any || d === 0) return null;
  return n / d;
}

export function funnelTotals(rows: readonly FunnelSumsRow[]): FunnelTotalsResult {
  const spend = sumReported(rows, (r) => r.spend) ?? 0;
  const impressions = sumReported(rows, (r) => r.impressions) ?? 0;
  const clicks = sumReported(rows, (r) => r.clicks) ?? 0;
  const conversions = sumReported(rows, (r) => r.conversions) ?? 0;
  const conversionValue = sumReported(rows, (r) => r.conversionValue) ?? 0;
  return {
    spend,
    impressions,
    clicks,
    conversions,
    conversionValue,
    landingPageViews: sumReported(rows, (r) => r.landingPageViews),
    addToCart: sumReported(rows, (r) => r.addToCart ?? null),
    addPayment: sumReported(rows, (r) => r.addPayment ?? null),
    // CPM/CTR/ROAS: every platform reports these inputs, so every row counts.
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpa: conversions > 0 ? spend / conversions : null,
    roas: spend > 0 ? conversionValue / spend : null,
    // The funnel steps: guarded both sides.
    voc: ratio(rows, (r) => r.landingPageViews, (r) => r.clicks),
    atcRate: ratio(rows, (r) => r.addToCart ?? null, (r) => r.landingPageViews),
    apRate: ratio(rows, (r) => r.addPayment ?? null, (r) => r.addToCart ?? null),
    purchaseRate: ratio(rows, (r) => r.conversions, (r) => r.addPayment ?? null),
    cvr: ratio(rows, (r) => r.conversions, (r) => r.landingPageViews),
  };
}
