import { and, between, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creatives,
  creativeTags,
  performanceRecords,
  platformEnum,
  creativeStatusEnum,
  creativeTypeEnum,
} from "@/db/schema";
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

type Platform = (typeof platformEnum)[number];
type CreativeType = (typeof creativeTypeEnum)[number];
type CreativeStatus = (typeof creativeStatusEnum)[number];

export interface KpiFilters {
  from: string; // ISO date YYYY-MM-DD
  to: string; // ISO date YYYY-MM-DD
  productIds?: string[];
  platforms?: Platform[];
  types?: CreativeType[];
  statuses?: CreativeStatus[];
  tags?: string[];
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
 * Honors every dashboard filter via URL searchParams (see tech-spec §8.1).
 * All blended/derived metrics come from `lib/metrics.ts` (weighted via
 * component sums per §8.2). Default filter strips rows with
 * `excluded_from_aggregates = true`; pass `includeExcluded` to drop that
 * filter for diagnostic views.
 */
export async function kpis(filters: KpiFilters): Promise<Kpis> {
  const conditions = [between(performanceRecords.date, filters.from, filters.to)];

  if (!filters.includeExcluded) {
    conditions.push(eq(performanceRecords.excludedFromAggregates, false));
  }

  if (filters.platforms && filters.platforms.length > 0) {
    conditions.push(inArray(performanceRecords.platform, filters.platforms));
  }

  // Filters that live on the `creatives` join: product / type / status / tag.
  const needsCreativeJoin =
    (filters.productIds && filters.productIds.length > 0) ||
    (filters.types && filters.types.length > 0) ||
    (filters.statuses && filters.statuses.length > 0);
  const needsTagJoin = filters.tags && filters.tags.length > 0;

  let q = db
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
    .$dynamic();

  if (needsCreativeJoin || needsTagJoin) {
    q = q.innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId));
    if (filters.productIds && filters.productIds.length > 0) {
      conditions.push(inArray(creatives.productId, filters.productIds));
    }
    if (filters.types && filters.types.length > 0) {
      conditions.push(inArray(creatives.type, filters.types));
    }
    if (filters.statuses && filters.statuses.length > 0) {
      conditions.push(inArray(creatives.status, filters.statuses));
    }
  }

  if (needsTagJoin && filters.tags) {
    q = q.innerJoin(creativeTags, eq(creativeTags.creativeId, performanceRecords.creativeId));
    conditions.push(inArray(creativeTags.tag, filters.tags));
  }

  const rows = await q.where(and(...conditions));
  const row = rows[0];

  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  return {
    spend: num(row?.spend),
    impressions: num(row?.impressions),
    clicks: num(row?.clicks),
    conversions: num(row?.conversions),
    conversionValue: num(row?.conversionValue),
    ctr: num(row?.ctr),
    cpm: num(row?.cpm),
    cpc: num(row?.cpc),
    cpa: num(row?.cpa),
    roas: num(row?.roas),
    hookRate: num(row?.hookRate),
    holdRate: num(row?.holdRate),
  };
}

/** Returns inclusive ISO date strings for a trailing window. */
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

export const rawSql = sql;
