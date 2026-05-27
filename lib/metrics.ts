import { sql, type SQL } from "drizzle-orm";
import { performanceRecords } from "@/db/schema";

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
