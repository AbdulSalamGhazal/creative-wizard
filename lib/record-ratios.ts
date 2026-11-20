import { funnelTotals } from "@/lib/funnel-totals";

/**
 * One row's OWN ratios — CTR, CPM, CPA, ROAS — from that row's own component
 * values, for the records tables' opt-in ratio columns (a raw record, or a
 * day's sums). It is `funnelTotals` over a single row, so the formulas are the
 * house JS mirror of `lib/metrics.ts` and never a second copy of them.
 *
 * NULL ≠ 0: a conversion count or value the platform didn't report yields a
 * NULL CPA / ROAS ("—"), not one computed from a fabricated zero; a zero
 * denominator is NULL too, never Infinity or NaN.
 */
export interface RatioInputs {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
}

export interface RecordRatios {
  ctr: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
}

export function recordRatios(r: RatioInputs): RecordRatios {
  const t = funnelTotals([
    {
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions ?? 0,
      conversionValue: r.conversionValue ?? 0,
      landingPageViews: null,
    },
  ]);
  return {
    ctr: t.ctr,
    cpm: t.cpm,
    cpa: r.conversions === null ? null : t.cpa,
    roas: r.conversionValue === null ? null : t.roas,
  };
}
