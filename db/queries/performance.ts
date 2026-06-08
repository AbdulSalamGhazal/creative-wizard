import { and, asc, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
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
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import type { CreativeStatus } from "@/lib/creative-status";
import {
  ctr,
  cpa,
  cpc,
  cpm,
  cvr,
  hookRate,
  holdRate,
  roas,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
  voc,
} from "@/lib/metrics";
import {
  addDays,
  computeDelta,
  dayCount,
  prevPeriod,
  type Delta,
} from "@/lib/period";
import { getActiveAccountId } from "@/lib/tenant";

type Platform = (typeof platformEnum)[number];
type CreativeType = (typeof creativeTypeEnum)[number];
/** The OLD, now-frozen manual status enum. Only kept for the (unused)
 *  `KpiFilters.statuses` field — the dynamic status comes from
 *  `@/lib/creative-status` via `CreativeStatus`. */
type FrozenStatus = (typeof creativeStatusEnum)[number];

export interface KpiFilters {
  from?: string; // ISO date YYYY-MM-DD; omit for all-time
  to?: string; // ISO date YYYY-MM-DD; omit for all-time
  productIds?: string[];
  platforms?: Platform[];
  types?: CreativeType[];
  /** No longer applied — the dynamic status can't be a SQL WHERE. Kept so
   *  existing callers that still pass it don't break. */
  statuses?: FrozenStatus[];
  tags?: string[];
  creativeIds?: string[];
  /** Combined "Campaign ➤ Adset" values to include (used by Compare sides). */
  campaignNames?: string[];
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
  cvr: number | null;
  voc: number | null;
  landingPageViews: number | null;
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
  cvr: number | null;
}

export interface ProductMixRow {
  productId: string;
  productName: string;
  spend: number;
  impressions: number;
  conversions: number | null;
}

export interface TypeMixRow {
  type: CreativeType;
  spend: number;
  impressions: number;
  conversions: number | null;
}

export interface TagMixRow {
  tag: string;
  spend: number;
  impressions: number;
  conversions: number | null;
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
  cvr: number | null;
  /** Daily-spend series across the filter window, ordered ASC by date. */
  sparkline: number[];
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Build the WHERE/JOIN scaffolding shared by every aggregation query. */
async function buildBaseConditions(filters: KpiFilters): Promise<{
  conditions: SQL[];
  needsCreativeJoin: boolean;
  needsTagJoin: boolean;
}> {
  const acct = await getActiveAccountId();
  const conditions: SQL[] = [eq(performanceRecords.accountId, acct)];

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
  if (filters.campaignNames && filters.campaignNames.length > 0) {
    conditions.push(
      inArray(performanceRecords.campaignName, filters.campaignNames),
    );
  }

  // NOTE: `filters.statuses` (the OLD manual status enum) is intentionally NOT
  // applied. Status is now DERIVED dynamically (spend-based) and can't be
  // expressed as a SQL WHERE here, so the aggregate views no longer filter by
  // it. The field is kept on KpiFilters for caller compatibility only.
  const needsCreativeJoin =
    (filters.productIds && filters.productIds.length > 0) ||
    (filters.types && filters.types.length > 0);

  if (needsCreativeJoin) {
    if (filters.productIds && filters.productIds.length > 0) {
      conditions.push(inArray(creatives.productId, filters.productIds));
    }
    if (filters.types && filters.types.length > 0) {
      conditions.push(inArray(creatives.type, filters.types));
    }
  }

  // Tag filter via a correlated EXISTS, NOT a JOIN. A creative can carry several
  // tags, so JOINing creative_tags fans out its performance rows (one copy per
  // matching tag) and inflates every SUM — e.g. a 2-tag creative filtered by
  // both tags would double its spend. EXISTS matches each row at most once.
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${creativeTags} WHERE ${creativeTags.creativeId} = ${performanceRecords.creativeId} AND ${inArray(creativeTags.tag, filters.tags)})`,
    );
  }

  return {
    conditions,
    needsCreativeJoin: needsCreativeJoin ?? false,
    // Tags are handled via EXISTS above (no join → no fan-out). Always false now;
    // the callers' `if (needsTagJoin) innerJoin(creativeTags)` blocks never fire.
    needsTagJoin: false,
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
    await buildBaseConditions(filters);

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
      cvr,
      voc,
      landingPageViews: sumLandingPageViews,
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
    cvr: num(row?.cvr),
    voc: num(row?.voc),
    landingPageViews: num(row?.landingPageViews),
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
    await buildBaseConditions(filters);

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
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

  // This query always needs the creatives + products join for the name/product
  // columns, regardless of which filters are active.
  let q = db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      productName: products.name,
      type: creatives.type,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      ctr,
      roas,
      cvr,
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
    .groupBy(creatives.id, creatives.name, products.name, creatives.type)
    .orderBy(desc(sumSpend))
    .limit(limit);

  // Derive the dynamic general status for the returned creatives.
  const sMap = await creativeStatusMap(rows.map((r) => r.creativeId));

  // Pull daily-spend series for the top creatives in one extra query so the
  // table can render sparklines without N+1.
  const topIds = rows.map((r) => r.creativeId);
  let sparkRows: Array<{ creativeId: string; date: string; spend: number | null }> = [];
  if (topIds.length > 0) {
    const sparkConditions: SQL[] = [
      inArray(performanceRecords.creativeId, topIds),
    ];
    if (filters.from && filters.to) {
      sparkConditions.push(
        between(performanceRecords.date, filters.from, filters.to),
      );
    }
    if (!filters.includeExcluded) {
      sparkConditions.push(eq(performanceRecords.excludedFromAggregates, false));
    }
    if (filters.platforms && filters.platforms.length > 0) {
      sparkConditions.push(
        inArray(performanceRecords.platform, filters.platforms),
      );
    }
    sparkRows = await db
      .select({
        creativeId: performanceRecords.creativeId,
        date: performanceRecords.date,
        spend: sumSpend,
      })
      .from(performanceRecords)
      .where(and(...sparkConditions))
      .groupBy(performanceRecords.creativeId, performanceRecords.date)
      .orderBy(performanceRecords.creativeId, performanceRecords.date);
  }

  const seriesByCreative = new Map<string, number[]>();
  for (const r of sparkRows) {
    const list = seriesByCreative.get(r.creativeId) ?? [];
    list.push(Number(r.spend ?? 0));
    seriesByCreative.set(r.creativeId, list);
  }

  return rows.map((r) => ({
    creativeId: r.creativeId,
    name: r.name,
    productName: r.productName,
    type: r.type as CreativeType,
    status: statusFor(sMap, r.creativeId).general,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: num(r.conversions),
    ctr: num(r.ctr),
    roas: num(r.roas),
    cvr: num(r.cvr),
    sparkline: seriesByCreative.get(r.creativeId) ?? [],
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
    await buildBaseConditions(filters);

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
      cvr,
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
    cvr: num(r.cvr),
  }));
}

export type BreakdownDimension = "platform" | "campaign";

export interface MetricBreakdownRow {
  /** Platform value (e.g. "instagram") or the combined campaign name. */
  key: string;
  spend: number;
  conversions: number | null;
  conversionValue: number | null;
  cpa: number | null;
  roas: number | null;
}

/**
 * Per-dimension metric breakdown for the Dashboard metric cards. Groups the
 * filtered records by EITHER platform OR campaign name and returns spend /
 * conversions / revenue / CPA / ROAS per group, ordered by spend desc. All
 * derived metrics use the canonical weighted fragments from `lib/metrics.ts`.
 *
 * `dimension = "campaign"` is used when the view is pinned to a single platform
 * (the filters already restrict to it), so the cards drill one level deeper.
 */
export async function metricBreakdown(
  filters: KpiFilters,
  dimension: BreakdownDimension,
): Promise<MetricBreakdownRow[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions(filters);

  const dimCol =
    dimension === "platform"
      ? performanceRecords.platform
      : performanceRecords.campaignName;

  let q = db
    .select({
      key: dimCol,
      spend: sumSpend,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
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
    .groupBy(dimCol)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    key: String(r.key),
    spend: Number(r.spend ?? 0),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    cpa: num(r.cpa),
    roas: num(r.roas),
  }));
}

export interface MetricOverTimeRow {
  date: string; // YYYY-MM-DD
  key: string; // platform value or campaign name
  spend: number;
  conversions: number | null;
  conversionValue: number | null;
  cpa: number | null;
  roas: number | null;
}

/**
 * Per-(date, dimension) metrics for the Dashboard's "X over time" line chart.
 * One row per (day, platform) — or (day, campaign) when the view is pinned to a
 * single platform — carrying every selectable metric so the client can switch
 * which one it plots without a refetch. Derived metrics use the canonical
 * weighted fragments. Ordered by date for a stable x-axis.
 */
export async function metricOverTime(
  filters: KpiFilters,
  dimension: BreakdownDimension,
): Promise<MetricOverTimeRow[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions(filters);

  const dimCol =
    dimension === "platform"
      ? performanceRecords.platform
      : performanceRecords.campaignName;

  let q = db
    .select({
      date: performanceRecords.date,
      key: dimCol,
      spend: sumSpend,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
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
    .groupBy(performanceRecords.date, dimCol)
    .orderBy(performanceRecords.date);

  return rows.map((r) => ({
    date: r.date,
    key: String(r.key),
    spend: Number(r.spend ?? 0),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    cpa: num(r.cpa),
    roas: num(r.roas),
  }));
}

export interface TypePlatformSpendRow {
  type: CreativeType;
  platform: Platform;
  spend: number;
}

/**
 * Spend per (creative type, platform) for the Dashboard's type-composition
 * chart — each type's magnitude plus how it splits across platforms. Joins
 * creatives for the `type` column; honors all base filters.
 */
export async function typePlatformSpend(
  filters: KpiFilters,
): Promise<TypePlatformSpendRow[]> {
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

  let q = db
    .select({
      type: creatives.type,
      platform: performanceRecords.platform,
      spend: sumSpend,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .$dynamic();

  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q
    .where(and(...conditions))
    .groupBy(creatives.type, performanceRecords.platform);

  return rows.map((r) => ({
    type: r.type as CreativeType,
    platform: r.platform as Platform,
    spend: Number(r.spend ?? 0),
  }));
}

/**
 * Spend per product for the Overview product-mix donut. Always joins
 * creatives → products. Filters from `buildBaseConditions` apply; we just
 * always need the products join here.
 */
export async function productMix(
  filters: KpiFilters,
): Promise<ProductMixRow[]> {
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

  let q = db
    .select({
      productId: products.id,
      productName: products.name,
      spend: sumSpend,
      impressions: sumImpressions,
      conversions: sumConversions,
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
    .groupBy(products.id, products.name)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    conversions: num(r.conversions),
  }));
}

/**
 * Spend per creative type (video / image / slides) for the Overview
 * type-mix donut. Always joins creatives for the `type` column.
 */
export async function typeMix(filters: KpiFilters): Promise<TypeMixRow[]> {
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

  let q = db
    .select({
      type: creatives.type,
      spend: sumSpend,
      impressions: sumImpressions,
      conversions: sumConversions,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .$dynamic();

  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const rows = await q
    .where(and(...conditions))
    .groupBy(creatives.type)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    type: r.type as CreativeType,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    conversions: num(r.conversions),
  }));
}

/**
 * Spend per tag for the Overview tag-mix donut. Joins creative_tags, so a
 * creative's spend counts toward each tag it carries (intentional fan-out
 * — the same semantics as the Trends "By tag" rollup).
 */
export async function tagMix(filters: KpiFilters): Promise<TagMixRow[]> {
  const acct = await getActiveAccountId();
  const conditions: SQL[] = [eq(performanceRecords.accountId, acct)];
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
  if (filters.productIds && filters.productIds.length > 0) {
    conditions.push(inArray(creatives.productId, filters.productIds));
  }
  if (filters.types && filters.types.length > 0) {
    conditions.push(inArray(creatives.type, filters.types));
  }
  // NOTE: `filters.statuses` is no longer applied — status is dynamic now.
  // When a tag filter is set we still group by tag; the filter narrows which
  // tags appear.
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(inArray(creativeTags.tag, filters.tags));
  }

  const rows = await db
    .select({
      tag: creativeTags.tag,
      spend: sumSpend,
      impressions: sumImpressions,
      conversions: sumConversions,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(creativeTags, eq(creativeTags.creativeId, creatives.id))
    .where(and(...conditions))
    .groupBy(creativeTags.tag)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    tag: r.tag,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    conversions: num(r.conversions),
  }));
}

export type CompareMetric =
  | "spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "ctr"
  | "cvr"
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
    await buildBaseConditions(filters);

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
    case "cvr":
      return cvr;
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
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

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

// =====================================================================
// Period-over-period (Trends / Over time)
// =====================================================================

export interface KpisWithDelta {
  current: Kpis;
  previous: Kpis;
  delta: {
    spend: Delta;
    impressions: Delta;
    clicks: Delta;
    conversions: Delta;
    ctr: Delta;
    cpm: Delta;
    cpc: Delta;
    cpa: Delta;
    roas: Delta;
    cvr: Delta;
    hookRate: Delta;
    holdRate: Delta;
  };
  /** ISO range of the prior window we compared against. */
  prevRange: { from: string; to: string };
}

/**
 * Run kpis() twice in parallel — once for the current window, once for the
 * immediately preceding window of equal length — and return both plus
 * per-metric deltas. Used by every Trends KPI tile.
 *
 * Requires `filters.from` and `filters.to` to be set (Trends views always
 * compare bounded windows; an all-time delta is meaningless).
 */
export async function kpisWithDelta(
  filters: KpiFilters & { from: string; to: string },
): Promise<KpisWithDelta> {
  const prev = prevPeriod(filters.from, filters.to);

  const [current, previous] = await Promise.all([
    kpis(filters),
    kpis({ ...filters, from: prev.from, to: prev.to }),
  ]);

  return {
    current,
    previous,
    prevRange: prev,
    delta: {
      spend: computeDelta(current.spend, previous.spend),
      impressions: computeDelta(current.impressions, previous.impressions),
      clicks: computeDelta(current.clicks, previous.clicks),
      conversions: computeDelta(current.conversions, previous.conversions),
      ctr: computeDelta(current.ctr, previous.ctr),
      cpm: computeDelta(current.cpm, previous.cpm),
      cpc: computeDelta(current.cpc, previous.cpc),
      cpa: computeDelta(current.cpa, previous.cpa),
      roas: computeDelta(current.roas, previous.roas),
      cvr: computeDelta(current.cvr, previous.cvr),
      hookRate: computeDelta(current.hookRate, previous.hookRate),
      holdRate: computeDelta(current.holdRate, previous.holdRate),
    },
  };
}

export interface SpendComparePoint {
  /**
   * Day offset from the start of the window (0-indexed). Both series use
   * the same offset so they line up on the X axis even though they
   * correspond to different calendar dates.
   */
  dayOffset: number;
  current: number | null;
  previous: number | null;
  /** Calendar date of the current series at this offset (YYYY-MM-DD). */
  currentDate: string;
  /** Calendar date of the prior series at this offset (YYYY-MM-DD). */
  previousDate: string;
}

/**
 * Two daily spend series (current + previous) zipped by day offset for the
 * Over-time comparison chart. We aggregate spend per date, then stitch the
 * two windows together client-side so the renderer doesn't have to.
 */
export async function spendByDateComparison(
  filters: KpiFilters & { from: string; to: string },
): Promise<SpendComparePoint[]> {
  const prev = prevPeriod(filters.from, filters.to);

  const [currRows, prevRows] = await Promise.all([
    spendByDate(filters),
    spendByDate({ ...filters, from: prev.from, to: prev.to }),
  ]);

  const currMap = new Map(currRows.map((r) => [r.date, r.spend]));
  const prevMap = new Map(prevRows.map((r) => [r.date, r.spend]));

  const length = dayCount(filters.from, filters.to);
  const out: SpendComparePoint[] = [];
  for (let i = 0; i < length; i++) {
    const currentDate = addDays(filters.from, i);
    const previousDate = addDays(prev.from, i);
    out.push({
      dayOffset: i,
      currentDate,
      previousDate,
      current: currMap.get(currentDate) ?? 0,
      previous: prevMap.get(previousDate) ?? 0,
    });
  }
  return out;
}

/** Single-series daily spend total (no platform breakdown). */
async function spendByDate(
  filters: KpiFilters,
): Promise<Array<{ date: string; spend: number }>> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions(filters);

  let q = db
    .select({
      date: performanceRecords.date,
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
    .groupBy(performanceRecords.date)
    .orderBy(performanceRecords.date);
  return rows.map((r) => ({ date: r.date, spend: Number(r.spend ?? 0) }));
}

export interface TopMoverRow {
  creativeId: string;
  name: string;
  productName: string;
  type: CreativeType;
  status: CreativeStatus;
  currentSpend: number;
  previousSpend: number;
  delta: Delta;
}

/**
 * Creatives sorted by absolute spend movement between the current and prior
 * windows. Used by the Over-time top-movers table — the question "what's
 * the biggest change?", not "what's biggest in absolute terms?".
 */
export async function topMovers(
  filters: KpiFilters & { from: string; to: string },
  limit = 10,
): Promise<TopMoverRow[]> {
  const prev = prevPeriod(filters.from, filters.to);

  const [currRows, prevRows] = await Promise.all([
    spendPerCreative(filters),
    spendPerCreative({ ...filters, from: prev.from, to: prev.to }),
  ]);

  const prevMap = new Map(prevRows.map((r) => [r.creativeId, r.spend]));
  const allIds = new Set<string>([
    ...currRows.map((r) => r.creativeId),
    ...prevRows.map((r) => r.creativeId),
  ]);
  const currMap = new Map(
    currRows.map((r) => [
      r.creativeId,
      { spend: r.spend, name: r.name, productName: r.productName, type: r.type },
    ]),
  );

  // For prior-only IDs we need the name/product too. Pull them in one batch.
  const priorOnlyIds = prevRows
    .filter((r) => !currMap.has(r.creativeId))
    .map((r) => r.creativeId);
  const priorOnlyMeta = new Map<
    string,
    { name: string; productName: string; type: CreativeType }
  >();
  if (priorOnlyIds.length > 0) {
    const metaRows = await db
      .select({
        id: creatives.id,
        name: creatives.name,
        productName: products.name,
        type: creatives.type,
      })
      .from(creatives)
      .innerJoin(products, eq(products.id, creatives.productId))
      .where(inArray(creatives.id, priorOnlyIds));
    for (const r of metaRows) {
      priorOnlyMeta.set(r.id, {
        name: r.name,
        productName: r.productName,
        type: r.type as CreativeType,
      });
    }
  }

  // Derive the dynamic general status once for the union of current + prior ids.
  const sMap = await creativeStatusMap([...allIds]);

  const rows: TopMoverRow[] = [];
  for (const id of allIds) {
    const cur = currMap.get(id);
    const previousSpend = prevMap.get(id) ?? 0;
    const currentSpend = cur?.spend ?? 0;
    if (currentSpend === 0 && previousSpend === 0) continue;
    const meta = cur ?? priorOnlyMeta.get(id);
    if (!meta) continue;
    rows.push({
      creativeId: id,
      name: meta.name,
      productName: meta.productName,
      type: meta.type,
      status: statusFor(sMap, id).general,
      currentSpend,
      previousSpend,
      delta: computeDelta(currentSpend, previousSpend),
    });
  }

  // Sort by absolute spend delta (USD), descending. We use the dollar swing
  // rather than the percentage so a $5k → $10k move ranks above a $20 → $80
  // move (which would otherwise dominate by percent).
  rows.sort((a, b) => {
    const aMove = Math.abs(a.currentSpend - a.previousSpend);
    const bMove = Math.abs(b.currentSpend - b.previousSpend);
    return bMove - aMove;
  });

  return rows.slice(0, limit);
}

interface SpendPerCreativeRow {
  creativeId: string;
  name: string;
  productName: string;
  type: CreativeType;
  spend: number;
}

async function spendPerCreative(
  filters: KpiFilters,
): Promise<SpendPerCreativeRow[]> {
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

  let q = db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      productName: products.name,
      type: creatives.type,
      spend: sumSpend,
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
    .groupBy(creatives.id, creatives.name, products.name, creatives.type);

  return rows.map((r) => ({
    creativeId: r.creativeId,
    name: r.name,
    productName: r.productName,
    type: r.type as CreativeType,
    spend: Number(r.spend ?? 0),
  }));
}

// =====================================================================
// Compare (two-sided A vs B)
// =====================================================================

export interface CompareDimensionRow {
  platform: Platform;
  campaign: string;
  creativeId: string;
  creativeName: string;
  productName: string;
}

/**
 * Distinct (platform, campaign, creative) combinations present in the data —
 * powers the cascading Platform → Campaign → Creative selectors on Compare.
 */
export async function compareDimensions(): Promise<CompareDimensionRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .selectDistinct({
      platform: performanceRecords.platform,
      campaign: performanceRecords.campaignName,
      creativeId: creatives.id,
      creativeName: creatives.name,
      productName: products.name,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.excludedFromAggregates, false),
      ),
    )
    .orderBy(
      asc(performanceRecords.platform),
      asc(performanceRecords.campaignName),
      asc(creatives.name),
    );
  return rows.map((r) => ({
    platform: r.platform as Platform,
    campaign: r.campaign,
    creativeId: r.creativeId,
    creativeName: r.creativeName,
    productName: r.productName,
  }));
}

/**
 * One daily series for a Compare side, aggregated across the side's filter
 * (platforms / campaigns / creatives). `value` is the chosen metric per day,
 * weighted via component sums.
 */
export async function compareSideSeries(
  filters: KpiFilters & { metric: CompareMetric },
): Promise<Array<{ date: string; value: number | null }>> {
  const { conditions, needsCreativeJoin } = await buildBaseConditions(filters);
  const metricSql = metricForCompare(filters.metric);
  let q = db
    .select({ date: performanceRecords.date, value: metricSql })
    .from(performanceRecords)
    .$dynamic();
  if (needsCreativeJoin) {
    q = q.innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId));
  }
  const rows = await q
    .where(and(...conditions))
    .groupBy(performanceRecords.date)
    .orderBy(performanceRecords.date);
  return rows.map((r) => ({
    date: r.date,
    value: r.value === null || r.value === undefined ? null : Number(r.value),
  }));
}

export const rawSql = sql;
