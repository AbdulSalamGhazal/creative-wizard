import { sql, type SQL } from "drizzle-orm";
import { performanceRecords, type platformEnum } from "@/db/schema";

type Platform = (typeof platformEnum)[number];

/**
 * Canonical weighted-aggregation SQL fragments.
 *
 * Every blended/aggregated metric in the system is computed as a weighted
 * average via component sums — `SUM(numerator) / NULLIF(SUM(denominator), 0)` —
 * never as `AVG(per-row ratio)`. `NULLIF(divisor, 0)` keeps undefined results
 * as NULL so the UI renders an em-dash instead of zero or infinity.
 *
 * All aggregation queries import these fragments; never open-code the formulas.
 * See `docs/tech-spec.md` §8.2 and `docs/prd.md` §5.4.
 */

const p = performanceRecords;

export const sumSpend: SQL<number> = sql<number>`SUM(${p.spend})`;
export const sumImpressions: SQL<number> = sql<number>`SUM(${p.impressions})`;
export const sumClicks: SQL<number> = sql<number>`SUM(${p.clicks})`;
export const sumConversions: SQL<number> = sql<number>`SUM(${p.conversions})`;
export const sumConversionValue: SQL<number> = sql<number>`SUM(${p.conversionValue})`;
export const sumVideoViews3s: SQL<number> = sql<number>`SUM(${p.videoViews3s})`;
export const sumVideoViews15s: SQL<number> = sql<number>`SUM(${p.videoViews15s})`;

export const ctr: SQL<number> = sql<number>`SUM(${p.clicks})::numeric / NULLIF(SUM(${p.impressions}), 0)`;
export const cpm: SQL<number> = sql<number>`SUM(${p.spend}) / NULLIF(SUM(${p.impressions}), 0) * 1000`;
export const cpc: SQL<number> = sql<number>`SUM(${p.spend}) / NULLIF(SUM(${p.clicks}), 0)`;
export const cpa: SQL<number> = sql<number>`SUM(${p.spend}) / NULLIF(SUM(${p.conversions}), 0)`;
export const roas: SQL<number> = sql<number>`SUM(${p.conversionValue}) / NULLIF(SUM(${p.spend}), 0)`;
export const hookRate: SQL<number> = sql<number>`SUM(${p.videoViews3s})::numeric / NULLIF(SUM(${p.impressions}), 0)`;
export const holdRate: SQL<number> = sql<number>`SUM(${p.videoViews15s})::numeric / NULLIF(SUM(${p.videoViews3s}), 0)`;

/**
 * Per-platform metric fragments built on Postgres FILTER aggregates. Used by
 * the Summary view to compute every platform's columns side-by-side in a
 * single grouped query — one row per creative, columns per (platform, metric).
 *
 * The formulas are identical to the unfiltered exports above: weighted via
 * component sums, NULLIF on the divisor. The only difference is the FILTER
 * predicate that restricts each SUM to its specific platform. This is the
 * ONLY correct way to compute per-platform CTR/CPM/CPC/CPA/ROAS/hook/hold —
 * never `AVG(per-row ratio)`.
 *
 * For "blended across the selected platforms" totals, the caller's WHERE
 * clause already restricts the joined rows; the unfiltered `ctr`, `cpa`,
 * `roas`, etc. fragments above handle those correctly.
 */
export interface MetricBlockSql {
  spend: SQL<number>;
  impressions: SQL<number>;
  clicks: SQL<number>;
  conversions: SQL<number>;
  conversionValue: SQL<number>;
  videoViews3s: SQL<number>;
  videoViews15s: SQL<number>;
  ctr: SQL<number>;
  cpm: SQL<number>;
  cpc: SQL<number>;
  cpa: SQL<number>;
  roas: SQL<number>;
  hookRate: SQL<number>;
  holdRate: SQL<number>;
}

/**
 * Build the full metric block restricted to the rows matching `predicate`
 * via Postgres FILTER aggregates. Component sums are filtered; derived
 * metrics are the canonical weighted ratios over those filtered sums —
 * never AVG of per-row ratios.
 *
 * Used for any "columns side-by-side" pivot: per-platform (Summary),
 * launch-window cohorts (first-7 / first-30 days from launch), etc.
 */
export function scopedMetrics(predicate: SQL): MetricBlockSql {
  const w = predicate;
  const spend = sql<number>`SUM(${p.spend}) FILTER (WHERE ${w})`;
  const impressions = sql<number>`SUM(${p.impressions}) FILTER (WHERE ${w})`;
  const clicks = sql<number>`SUM(${p.clicks}) FILTER (WHERE ${w})`;
  const conversions = sql<number>`SUM(${p.conversions}) FILTER (WHERE ${w})`;
  const conversionValue = sql<number>`SUM(${p.conversionValue}) FILTER (WHERE ${w})`;
  const videoViews3s = sql<number>`SUM(${p.videoViews3s}) FILTER (WHERE ${w})`;
  const videoViews15s = sql<number>`SUM(${p.videoViews15s}) FILTER (WHERE ${w})`;
  return {
    spend,
    impressions,
    clicks,
    conversions,
    conversionValue,
    videoViews3s,
    videoViews15s,
    ctr: sql<number>`${clicks}::numeric / NULLIF(${impressions}, 0)`,
    cpm: sql<number>`${spend} / NULLIF(${impressions}, 0) * 1000`,
    cpc: sql<number>`${spend} / NULLIF(${clicks}, 0)`,
    cpa: sql<number>`${spend} / NULLIF(${conversions}, 0)`,
    roas: sql<number>`${conversionValue} / NULLIF(${spend}, 0)`,
    hookRate: sql<number>`${videoViews3s}::numeric / NULLIF(${impressions}, 0)`,
    holdRate: sql<number>`${videoViews15s}::numeric / NULLIF(${videoViews3s}, 0)`,
  };
}

/** Per-platform metric block — a `scopedMetrics` over `platform = X`. */
export function platformMetrics(platform: Platform): MetricBlockSql {
  return scopedMetrics(sql`${p.platform} = ${platform}`);
}
