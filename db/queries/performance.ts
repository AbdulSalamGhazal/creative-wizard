import { and, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creatives,
  creativeTags,
  performanceRecords,
  products,
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
  from?: string; // ISO date YYYY-MM-DD; omit for all-time
  to?: string; // ISO date YYYY-MM-DD; omit for all-time
  productIds?: string[];
  platforms?: Platform[];
  types?: CreativeType[];
  statuses?: CreativeStatus[];
  tags?: string[];
  creativeIds?: string[];
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

export interface SpendByDatePlatform {
  date: string; // YYYY-MM-DD
  platform: Platform;
  spend: number;
}

export interface PlatformMixRow {
  platform: Platform;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
}

export interface TopCreativeRow {
  creativeId: string;
  name: string;
  productName: string;
  type: CreativeType;
  status: CreativeStatus;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  ctr: number | null;
  roas: number | null;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Build the WHERE/JOIN scaffolding shared by every aggregation query. */
function buildBaseConditions(filters: KpiFilters): {
  conditions: SQL[];
  needsCreativeJoin: boolean;
  needsTagJoin: boolean;
} {
  const conditions: SQL[] = [];

  if (filters.from && filters.to) {
    conditions.push(between(performanceRecords.date, filters.from, filters.to));
  }
  if (!filters.includeExcluded) {
    conditions.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (filters.platforms && filters.platforms.length > 0) {
    conditions.push(inArray(performanceRecords.platform, filters.platforms));
  }
  if (filters.creativeIds && filters.creativeIds.length > 0) {
    conditions.push(inArray(performanceRecords.creativeId, filters.creativeIds));
  }

  const needsCreativeJoin =
    (filters.productIds && filters.productIds.length > 0) ||
    (filters.types && filters.types.length > 0) ||
    (filters.statuses && filters.statuses.length > 0);
  const needsTagJoin = !!(filters.tags && filters.tags.length > 0);

  if (needsCreativeJoin) {
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
    conditions.push(inArray(creativeTags.tag, filters.tags));
  }

  return {
    conditions,
    needsCreativeJoin: needsCreativeJoin ?? false,
    needsTagJoin,
  };
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
  const { conditions, needsCreativeJoin, needsTagJoin } =
    buildBaseConditions(filters);

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
  }
  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q.where(and(...conditions));
  const row = rows[0];

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

/**
 * Spend per (date, platform) for the Spend-over-time stacked area chart.
 * Returns one row per (date, platform) that has at least one performance
 * record after filtering. JS-side pivot is the caller's responsibility.
 */
export async function spendByDatePlatform(
  filters: KpiFilters,
): Promise<SpendByDatePlatform[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    buildBaseConditions(filters);

  let q = db
    .select({
      date: performanceRecords.date,
      platform: performanceRecords.platform,
      spend: sumSpend,
    })
    .from(performanceRecords)
    .$dynamic();

  if (needsCreativeJoin || needsTagJoin) {
    q = q.innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId));
  }
  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q
    .where(and(...conditions))
    .groupBy(performanceRecords.date, performanceRecords.platform)
    .orderBy(performanceRecords.date);

  return rows.map((r) => ({
    date: r.date,
    platform: r.platform as Platform,
    spend: Number(r.spend ?? 0),
  }));
}

/**
 * Top N creatives by spend over the filter window. Joins creatives + products
 * so the table can render the human-readable product name without a second
 * round-trip.
 */
export async function topCreatives(
  filters: KpiFilters,
  limit = 10,
): Promise<TopCreativeRow[]> {
  const { conditions, needsTagJoin } = buildBaseConditions(filters);

  // This query always needs the creatives + products join for the name/product
  // columns, regardless of which filters are active.
  let q = db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      productName: products.name,
      type: creatives.type,
      status: creatives.status,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      ctr,
      roas,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .$dynamic();

  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q
    .where(and(...conditions))
    .groupBy(creatives.id, creatives.name, products.name, creatives.type, creatives.status)
    .orderBy(desc(sumSpend))
    .limit(limit);

  return rows.map((r) => ({
    creativeId: r.creativeId,
    name: r.name,
    productName: r.productName,
    type: r.type as CreativeType,
    status: r.status as CreativeStatus,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: num(r.conversions),
    ctr: num(r.ctr),
    roas: num(r.roas),
  }));
}

/**
 * Spend per platform for the platform-mix donut. Always returns one row per
 * platform that has at least one record after filtering. Ordered by spend
 * descending so the donut renders biggest-slice-first.
 */
export async function platformMix(
  filters: KpiFilters,
): Promise<PlatformMixRow[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    buildBaseConditions(filters);

  let q = db
    .select({
      platform: performanceRecords.platform,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      ctr,
      cpa,
      roas,
    })
    .from(performanceRecords)
    .$dynamic();

  if (needsCreativeJoin || needsTagJoin) {
    q = q.innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId));
  }
  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q
    .where(and(...conditions))
    .groupBy(performanceRecords.platform)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    platform: r.platform as Platform,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: num(r.conversions),
    ctr: num(r.ctr),
    cpa: num(r.cpa),
    roas: num(r.roas),
  }));
}

export type CompareMetric =
  | "spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "ctr"
  | "cpm"
  | "cpc"
  | "cpa"
  | "roas"
  | "hookRate";

export interface CompareSeriesPoint {
  creativeId: string;
  date: string;
  value: number | null;
}

export interface CompareTotalsRow {
  creativeId: string;
  creativeName: string;
  productName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  ctr: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
  hookRate: number | null;
}

/** Time-series per creative for the chosen metric. */
export async function compareSeries(
  filters: KpiFilters & { creativeIds: string[]; metric: CompareMetric },
): Promise<CompareSeriesPoint[]> {
  if (filters.creativeIds.length === 0) return [];
  const { conditions, needsCreativeJoin, needsTagJoin } =
    buildBaseConditions(filters);

  const metricSql = metricForCompare(filters.metric);

  let q = db
    .select({
      creativeId: performanceRecords.creativeId,
      date: performanceRecords.date,
      value: metricSql,
    })
    .from(performanceRecords)
    .$dynamic();

  if (needsCreativeJoin || needsTagJoin) {
    q = q.innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId));
  }
  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q
    .where(and(...conditions))
    .groupBy(performanceRecords.creativeId, performanceRecords.date)
    .orderBy(performanceRecords.date);

  return rows.map((r) => ({
    creativeId: r.creativeId,
    date: r.date,
    value: r.value === null || r.value === undefined ? null : Number(r.value),
  }));
}

function metricForCompare(m: CompareMetric): SQL<number> {
  switch (m) {
    case "spend":
      return sumSpend;
    case "impressions":
      return sumImpressions;
    case "clicks":
      return sumClicks;
    case "conversions":
      return sumConversions as SQL<number>;
    case "ctr":
      return ctr;
    case "cpm":
      return cpm;
    case "cpc":
      return cpc;
    case "cpa":
      return cpa;
    case "roas":
      return roas;
    case "hookRate":
      return hookRate;
  }
}

/** Per-creative totals for the comparison table. */
export async function compareTotals(
  filters: KpiFilters & { creativeIds: string[] },
): Promise<CompareTotalsRow[]> {
  if (filters.creativeIds.length === 0) return [];
  const { conditions, needsTagJoin } = buildBaseConditions(filters);

  let q = db
    .select({
      creativeId: creatives.id,
      creativeName: creatives.name,
      productName: products.name,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      ctr,
      cpm,
      cpa,
      roas,
      hookRate,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .$dynamic();

  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q
    .where(and(...conditions))
    .groupBy(creatives.id, creatives.name, products.name);

  return rows.map((r) => ({
    creativeId: r.creativeId,
    creativeName: r.creativeName,
    productName: r.productName,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: num(r.conversions),
    ctr: num(r.ctr),
    cpm: num(r.cpm),
    cpa: num(r.cpa),
    roas: num(r.roas),
    hookRate: num(r.hookRate),
  }));
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
