import { and, between, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import {
  ctr,
  cpa,
  cpc,
  cpm,
  hookRate,
  holdRate,
  roas,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumSpend,
} from "@/lib/metrics";

export interface KpiFilters {
  from: string; // ISO date YYYY-MM-DD
  to: string; // ISO date YYYY-MM-DD
  includeExcluded?: boolean;
}

export interface Kpis {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionValue: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
  hookRate: number | null;
  holdRate: number | null;
}

/**
 * KPI aggregates for the Overview tiles.
 *
 * All blended/derived metrics come from `lib/metrics.ts` (weighted via
 * component sums per tech-spec §8.2). Default filter strips rows with
 * `excluded_from_aggregates = true`; pass `includeExcluded` to drop that
 * filter for diagnostic views.
 */
export async function kpis(filters: KpiFilters): Promise<Kpis> {
  const conditions = [between(performanceRecords.date, filters.from, filters.to)];
  if (!filters.includeExcluded) {
    conditions.push(eq(performanceRecords.excludedFromAggregates, false));
  }

  const [row] = await db
    .select({
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      ctr,
      cpm,
      cpc,
      cpa,
      roas,
      hookRate,
      holdRate,
    })
    .from(performanceRecords)
    .where(and(...conditions));

  if (!row) {
    return {
      spend: null,
      impressions: null,
      clicks: null,
      conversions: null,
      conversionValue: null,
      ctr: null,
      cpm: null,
      cpc: null,
      cpa: null,
      roas: null,
      hookRate: null,
      holdRate: null,
    };
  }

  // Drizzle returns numeric/bigint columns as strings to preserve precision.
  // Coerce to JS numbers for the UI layer; NULL stays as null.
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  return {
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    conversions: num(row.conversions),
    conversionValue: num(row.conversionValue),
    ctr: num(row.ctr),
    cpm: num(row.cpm),
    cpc: num(row.cpc),
    cpa: num(row.cpa),
    roas: num(row.roas),
    hookRate: num(row.hookRate),
    holdRate: num(row.holdRate),
  };
}

/**
 * Convenience: returns the inclusive ISO date strings for a trailing window.
 */
export function defaultDateRange(days: number): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

// Aliased SQL helper so callers can import without pulling in drizzle-orm.
export const rawSql = sql;
