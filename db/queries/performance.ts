import { and, asc, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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
import { FATIGUE_WINDOWS, type FatigueWindowSums } from "@/lib/launch-fatigue";
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

export interface LeaderboardRow {
  creativeId: string;
  name: string;
  productName: string;
  type: CreativeType;
  status: CreativeStatus;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  /** Daily-spend series across the filter window, ordered ASC by date. Only
   *  populated for the ranking-candidate pool (see creativeLeaderboard). */
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
 * All creatives over the filter window with their full metric set, for the
 * dashboard leaderboard table — the client re-ranks (by spend / CPM / CTR / VOC
 * / CvR / ROAS) and slices the top N, so the whole candidate set is returned,
 * not a pre-sliced top-N. Joins creatives + products for the human-readable
 * names. Daily-spend sparklines are fetched only for the ranking-candidate pool
 * (the union of the top 12 by each rankable metric), so any displayed row has
 * its trend without pulling daily rows for every creative.
 */
export async function creativeLeaderboard(
  filters: KpiFilters,
  minSpend = 300,
): Promise<LeaderboardRow[]> {
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

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
      conversionValue: sumConversionValue,
      cpm,
      ctr,
      voc,
      cvr,
      cpa,
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

  const raw = await q
    .where(and(...conditions))
    .groupBy(creatives.id, creatives.name, products.name, creatives.type)
    .orderBy(desc(sumSpend));

  const base = raw
    .map((r) => ({
      creativeId: r.creativeId,
      name: r.name,
      productName: r.productName,
      type: r.type as CreativeType,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      conversions: num(r.conversions),
      conversionValue: num(r.conversionValue),
      cpm: num(r.cpm),
      ctr: num(r.ctr),
      voc: num(r.voc),
      cvr: num(r.cvr),
      cpa: num(r.cpa),
      roas: num(r.roas),
    }))
    // Spend floor: creatives below it carry too little signal to rank on (a $5
    // creative shouldn't top the CTR/ROAS board), so they're dropped before
    // both the candidate pool and the client-side ranking.
    .filter((r) => r.spend >= minSpend);

  // Candidate pool = union of the top 12 by each rankable metric.
  const RANK: Array<{
    pick: (r: (typeof base)[number]) => number | null;
    lower?: boolean;
  }> = [
    { pick: (r) => r.spend },
    { pick: (r) => r.cpm, lower: true },
    { pick: (r) => r.ctr },
    { pick: (r) => r.voc },
    { pick: (r) => r.cvr },
    { pick: (r) => r.roas },
  ];
  const pool = new Set<string>();
  for (const { pick, lower } of RANK) {
    [...base]
      .filter((r) => pick(r) !== null)
      .sort((a, b) => (lower ? pick(a)! - pick(b)! : pick(b)! - pick(a)!))
      .slice(0, 12)
      .forEach((r) => pool.add(r.creativeId));
  }

  const sMap = await creativeStatusMap(base.map((r) => r.creativeId));

  const seriesByCreative = new Map<string, number[]>();
  const poolIds = [...pool];
  if (poolIds.length > 0) {
    // Mirror the base query's record-level scope so the sparkline can't diverge
    // from the aggregate: account (defense-in-depth), date, excluded, platform,
    // and campaign. (Creative-level filters — product/type/tag — are already
    // baked into poolIds, which is a subset of the filtered `base`.)
    const acct = await getActiveAccountId();
    const sparkConditions: SQL[] = [
      inArray(performanceRecords.creativeId, poolIds),
      eq(performanceRecords.accountId, acct),
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
    if (filters.campaignNames && filters.campaignNames.length > 0) {
      sparkConditions.push(
        inArray(performanceRecords.campaignName, filters.campaignNames),
      );
    }
    const sparkRows = await db
      .select({
        creativeId: performanceRecords.creativeId,
        date: performanceRecords.date,
        spend: sumSpend,
      })
      .from(performanceRecords)
      .where(and(...sparkConditions))
      .groupBy(performanceRecords.creativeId, performanceRecords.date)
      .orderBy(performanceRecords.creativeId, performanceRecords.date);
    for (const r of sparkRows) {
      const list = seriesByCreative.get(r.creativeId) ?? [];
      list.push(Number(r.spend ?? 0));
      seriesByCreative.set(r.creativeId, list);
    }
  }

  return base.map((r) => ({
    ...r,
    status: statusFor(sMap, r.creativeId).general,
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

export interface CampaignMixRow extends PlatformMixRow {
  /** Combined `Campaign ➤ Adset` (with platform suffix for IG/FB). */
  campaign: string;
}

/**
 * Same shape as {@link platformMix} but one row per (platform, campaign) — the
 * per-platform totals broken out by campaign. Used by the creative detail page
 * to expand each platform row into its campaigns. Honours the same filters
 * (creativeIds, date range, excluded, account scope) via buildBaseConditions.
 */
export async function campaignMix(
  filters: KpiFilters,
): Promise<CampaignMixRow[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions(filters);

  let q = db
    .select({
      platform: performanceRecords.platform,
      campaign: performanceRecords.campaignName,
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
    .groupBy(performanceRecords.platform, performanceRecords.campaignName)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    platform: r.platform as Platform,
    campaign: r.campaign as string,
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

export interface CreativePoint {
  creativeId: string;
  name: string;
  spend: number;
  roas: number | null;
  conversions: number | null;
}

/**
 * One lean row per creative (spend / ROAS / conversions) for the Dashboard's
 * spend-vs-ROAS scatter and rating distribution. Ordered by spend desc; only
 * creatives with spend in the window. No product join / sparkline (unlike
 * topCreatives) so it stays cheap across the whole library.
 */
export async function creativePoints(
  filters: KpiFilters,
): Promise<CreativePoint[]> {
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

  let q = db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      spend: sumSpend,
      roas,
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
    .groupBy(creatives.id, creatives.name)
    .orderBy(desc(sumSpend));

  return rows
    .map((r) => ({
      creativeId: r.creativeId,
      name: r.name,
      spend: Number(r.spend ?? 0),
      roas: num(r.roas),
      conversions: num(r.conversions),
    }))
    .filter((r) => r.spend > 0);
}

export interface DailyRatesRow {
  date: string;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
}

/**
 * Per-day blended funnel rates (CPM / CTR / VOC / CvR) for the Dashboard's
 * funnel-rate sparklines. Each day's rate is the weighted ratio of that day's
 * component sums. Ordered by date.
 */
export async function dailyFunnelRates(
  filters: KpiFilters,
): Promise<DailyRatesRow[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions(filters);

  let q = db
    .select({ date: performanceRecords.date, cpm, ctr, voc, cvr })
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

  return rows.map((r) => ({
    date: r.date,
    cpm: num(r.cpm),
    ctr: num(r.ctr),
    voc: num(r.voc),
    cvr: num(r.cvr),
  }));
}

export interface CreativeMetricRow {
  spend: number;
  impressions: number;
  cpm: number | null;
  ctr: number | null;
  hookRate: number | null;
  holdRate: number | null;
  voc: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
}

/**
 * One row per creative with its blended funnel + outcome metrics, for the
 * per-creative correlation matrix. Each rate is the weighted ratio of that
 * creative's component sums (canonical fragments from `lib/metrics.ts`), so a
 * creative that never converted yields NULL CvR/ROAS rather than 0 — and is
 * dropped pairwise when correlating. Only creatives with spend are returned.
 */
export async function creativeMetricRows(
  filters: KpiFilters,
): Promise<CreativeMetricRow[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions(filters);

  let q = db
    .select({
      spend: sumSpend,
      impressions: sumImpressions,
      cpm,
      ctr,
      hookRate,
      holdRate,
      voc,
      cvr,
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
    .groupBy(performanceRecords.creativeId);

  return rows
    .map((r) => ({
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      cpm: num(r.cpm),
      ctr: num(r.ctr),
      hookRate: num(r.hookRate),
      holdRate: num(r.holdRate),
      voc: num(r.voc),
      cvr: num(r.cvr),
      cpa: num(r.cpa),
      roas: num(r.roas),
    }))
    .filter((r) => r.spend > 0);
}

export interface CreativeDimensionPoint {
  key: string; // platform value or campaign name
  spend: number;
  roas: number | null;
}

/**
 * Spend + ROAS per (creative, dimension) block — one row per creative on each
 * platform (or campaign when pinned). Used by the rating-mix composition: each
 * block is rated individually, then spend is summed by (dimension, rating).
 */
export async function creativeDimensionPoints(
  filters: KpiFilters,
  dimension: "platform" | "campaign",
): Promise<CreativeDimensionPoint[]> {
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions(filters);

  const dimCol =
    dimension === "platform"
      ? performanceRecords.platform
      : performanceRecords.campaignName;

  let q = db
    .select({
      creativeId: performanceRecords.creativeId,
      key: dimCol,
      spend: sumSpend,
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
    .groupBy(performanceRecords.creativeId, dimCol);

  return rows
    .map((r) => ({
      key: String(r.key),
      spend: Number(r.spend ?? 0),
      roas: num(r.roas),
    }))
    .filter((r) => r.spend > 0);
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

export interface TypeDimensionSpendRow {
  type: CreativeType;
  key: string; // platform value or campaign name
  spend: number;
}

/**
 * Spend per (creative type, dimension) for the Dashboard's type-mix lines —
 * each dimension's spend split across the creative types. Dimension is platform
 * normally, or campaign when the view is pinned to a single platform. Joins
 * creatives for the `type` column; honors all base filters.
 */
export async function typeDimensionSpend(
  filters: KpiFilters,
  dimension: BreakdownDimension,
): Promise<TypeDimensionSpendRow[]> {
  const { conditions, needsTagJoin } = await buildBaseConditions(filters);

  const dimCol =
    dimension === "platform"
      ? performanceRecords.platform
      : performanceRecords.campaignName;

  let q = db
    .select({
      type: creatives.type,
      key: dimCol,
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
    .groupBy(creatives.type, dimCol);

  return rows.map((r) => ({
    type: r.type as CreativeType,
    key: String(r.key),
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

// =====================================================================
// Change breakdown — powers Trends → Over time ("what changed")
// =====================================================================

export type ChangeDim = "platform" | "campaign" | "creative";

export interface ChangeBreakdownEntity {
  /** platform value / campaign name / creative id, per dim. */
  key: string;
  /** Display label (creative NAME for the creative dim). */
  label: string;
  /** Secondary line — the product name (creative dim only). */
  sub: string | null;
  cur: ChangeWindowSums;
  prev: ChangeWindowSums;
}

export interface ChangeWindowSums {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
}

/**
 * Component sums per entity (platform / campaign / creative) for the selected
 * window AND the immediately-prior equal-length window, in one scan: the WHERE
 * spans both windows and FILTER clauses split the aggregates. Ratios are
 * recombined in lib/change-radar.ts from these sums (weighted averages).
 * Entities with no rows in either window simply don't appear.
 */
export async function changeBreakdown(
  filters: KpiFilters & { from: string; to: string },
  dim: ChangeDim,
): Promise<{
  rows: ChangeBreakdownEntity[];
  prevRange: { from: string; to: string };
}> {
  const prev = prevPeriod(filters.from, filters.to);
  // Span both windows; the per-window split happens in the FILTER clauses.
  const { conditions, needsCreativeJoin, needsTagJoin } =
    await buildBaseConditions({ ...filters, from: prev.from, to: filters.to });

  const inCur = sql`${performanceRecords.date} BETWEEN ${filters.from} AND ${filters.to}`;
  const inPrev = sql`${performanceRecords.date} BETWEEN ${prev.from} AND ${prev.to}`;
  const split = (col: AnyPgColumn) => ({
    cur: sql<string>`COALESCE(SUM(${col}) FILTER (WHERE ${inCur}), 0)`,
    prev: sql<string>`COALESCE(SUM(${col}) FILTER (WHERE ${inPrev}), 0)`,
  });
  const spend = split(performanceRecords.spend);
  const impressions = split(performanceRecords.impressions);
  const clicks = split(performanceRecords.clicks);
  const conversions = split(performanceRecords.conversions);
  const conversionValue = split(performanceRecords.conversionValue);
  const landingPageViews = split(performanceRecords.landingPageViews);

  const keyExpr =
    dim === "platform"
      ? performanceRecords.platform
      : dim === "campaign"
        ? performanceRecords.campaignName
        : creatives.id;

  let q = db
    .select({
      key: keyExpr,
      label: dim === "creative" ? creatives.name : keyExpr,
      sub: dim === "creative" ? products.name : sql<string | null>`NULL`,
      spendCur: spend.cur,
      spendPrev: spend.prev,
      imprCur: impressions.cur,
      imprPrev: impressions.prev,
      clicksCur: clicks.cur,
      clicksPrev: clicks.prev,
      convCur: conversions.cur,
      convPrev: conversions.prev,
      cvCur: conversionValue.cur,
      cvPrev: conversionValue.prev,
      lpvCur: landingPageViews.cur,
      lpvPrev: landingPageViews.prev,
    })
    .from(performanceRecords)
    .$dynamic();

  const joinCreatives = dim === "creative" || needsCreativeJoin || needsTagJoin;
  if (joinCreatives) {
    q = q.innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId));
  }
  if (dim === "creative") {
    q = q.innerJoin(products, eq(products.id, creatives.productId));
  }
  if (needsTagJoin) {
    q = q.innerJoin(
      creativeTags,
      eq(creativeTags.creativeId, performanceRecords.creativeId),
    );
  }

  const grouped =
    dim === "creative"
      ? q.groupBy(creatives.id, creatives.name, products.name)
      : q.groupBy(keyExpr);

  const rows = await grouped.where(and(...conditions));

  return {
    prevRange: prev,
    rows: rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      sub: r.sub === null ? null : String(r.sub),
      cur: {
        spend: num(r.spendCur) ?? 0,
        impressions: num(r.imprCur) ?? 0,
        clicks: num(r.clicksCur) ?? 0,
        conversions: num(r.convCur) ?? 0,
        conversionValue: num(r.cvCur) ?? 0,
        landingPageViews: num(r.lpvCur) ?? 0,
      },
      prev: {
        spend: num(r.spendPrev) ?? 0,
        impressions: num(r.imprPrev) ?? 0,
        clicks: num(r.clicksPrev) ?? 0,
        conversions: num(r.convPrev) ?? 0,
        conversionValue: num(r.cvPrev) ?? 0,
        landingPageViews: num(r.lpvPrev) ?? 0,
      },
    })),
  };
}

// =====================================================================
// Launch fatigue — powers Trends → Launches
// =====================================================================

export interface LaunchFatigueFilters {
  /** Cohort filter — keep creatives whose effective launch falls in [from, to]. */
  launchedFrom?: string;
  launchedTo?: string;
  platforms?: Platform[];
  productIds?: string[];
  types?: CreativeType[];
  tags?: string[];
  includeExcluded?: boolean;
}

export interface LaunchFatigueRow {
  creativeId: string;
  name: string;
  productName: string;
  type: CreativeType;
  /** Effective launch day (manual launch_date, else the first day with spend). */
  launchDate: string;
  /** True when launchDate fell back to the first-spend day. */
  derived: boolean;
  daysSinceLaunch: number;
  w1: FatigueWindowSums; // days 1–7
  w2: FatigueWindowSums; // days 8–30
  w3: FatigueWindowSums; // days 31–90
}

/**
 * Per-creative component sums over three SEPARATE windows anchored to each
 * creative's own launch day (0 = launch): days 1–7, 8–30, 31–90. Launch =
 * `launch_date`, falling back to the creative's first spend day so creatives
 * without a manual date still appear. Ratios + the fatigue verdict are derived
 * from these sums in lib/launch-fatigue.ts. Filters scope which creatives and
 * which performance rows count; `launchedFrom`/`launchedTo` filter by launch
 * date (cohort). Creatives with no spend in the selected scope are dropped.
 */
export async function launchFatigue(
  f: LaunchFatigueFilters,
): Promise<LaunchFatigueRow[]> {
  const acct = await getActiveAccountId();
  const inList = (vals: string[]) =>
    sql.join(
      vals.map((v) => sql`${v}`),
      sql`, `,
    );

  // Creative-side filters live in the eff CTE so they bound the cohort.
  const creativeConds: SQL[] = [];
  if (f.types?.length) creativeConds.push(sql`c.type IN (${inList(f.types)})`);
  if (f.productIds?.length)
    creativeConds.push(sql`c.product_id IN (${inList(f.productIds)})`);
  if (f.tags?.length)
    creativeConds.push(
      sql`EXISTS (SELECT 1 FROM creative_tags ct WHERE ct.creative_id = c.id AND ct.tag IN (${inList(f.tags)}))`,
    );
  const creativeWhere = creativeConds.length
    ? sql` AND ${sql.join(creativeConds, sql` AND `)}`
    : sql``;

  // Perf-row scoping on the join (platform / excluded) so a creative still
  // appears even if a filter zeroes it out — those are dropped below.
  const platformJoin = f.platforms?.length
    ? sql` AND pr.platform IN (${inList(f.platforms)})`
    : sql``;
  const excludedJoin = f.includeExcluded
    ? sql``
    : sql` AND pr.excluded_from_aggregates = false`;
  const cohortWhere =
    f.launchedFrom && f.launchedTo
      ? sql` AND eff.eff_launch BETWEEN ${f.launchedFrom} AND ${f.launchedTo}`
      : sql``;

  const winSum = (col: string, lo: number, hi: number) =>
    sql`COALESCE(SUM(pr.${sql.raw(col)}) FILTER (WHERE (pr.date - eff.eff_launch) BETWEEN ${lo} AND ${hi}), 0)`;
  // Derive the window bounds from the shared definition so the SQL and UI never
  // drift. `maxDay` also caps the join below to the last window's last day.
  const windows = FATIGUE_WINDOWS.map((w) => ({
    p: w.key,
    lo: w.startDay,
    hi: w.endDay,
  }));
  const maxDay = Math.max(...FATIGUE_WINDOWS.map((w) => w.endDay));
  const cols: Array<[alias: string, col: string]> = [
    ["spend", "spend"],
    ["cv", "conversion_value"],
    ["clicks", "clicks"],
    ["impr", "impressions"],
    ["conv", "conversions"],
    ["lpv", "landing_page_views"],
  ];
  const sumSelects = windows.flatMap((w) =>
    cols.map(
      ([alias, col]) =>
        sql`${winSum(col, w.lo, w.hi)} AS ${sql.raw(`${w.p}_${alias}`)}`,
    ),
  );

  const rows = (await db.execute(sql`
    WITH eff AS (
      SELECT c.id, c.name, c.type, p.name AS product_name,
             (c.launch_date IS NULL) AS derived,
             COALESCE(c.launch_date, (
               SELECT MIN(pr0.date) FROM performance_records pr0
               WHERE pr0.creative_id = c.id AND pr0.excluded_from_aggregates = false
             )) AS eff_launch
      FROM creatives c
      JOIN products p ON p.id = c.product_id
      WHERE c.account_id = ${acct}${creativeWhere}
    )
    SELECT eff.id, eff.name, eff.type, eff.product_name, eff.derived,
           eff.eff_launch::text AS eff_launch,
           (CURRENT_DATE - eff.eff_launch)::int AS days_since,
           ${sql.join(sumSelects, sql`, `)}
    FROM eff
    LEFT JOIN performance_records pr
      ON pr.creative_id = eff.id
      AND pr.date >= eff.eff_launch
      AND pr.date <= eff.eff_launch + ${maxDay}::int${platformJoin}${excludedJoin}
    WHERE eff.eff_launch IS NOT NULL${cohortWhere}
    GROUP BY eff.id, eff.name, eff.type, eff.product_name, eff.derived, eff.eff_launch
    ORDER BY eff.eff_launch DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const winFor = (r: Record<string, unknown>, p: string): FatigueWindowSums => ({
    spend: Number(r[`${p}_spend`] ?? 0),
    conversionValue: Number(r[`${p}_cv`] ?? 0),
    clicks: Number(r[`${p}_clicks`] ?? 0),
    impressions: Number(r[`${p}_impr`] ?? 0),
    conversions: Number(r[`${p}_conv`] ?? 0),
    landingPageViews: Number(r[`${p}_lpv`] ?? 0),
  });

  return rows
    .map((r) => {
      const w1 = winFor(r, "w1");
      const w2 = winFor(r, "w2");
      const w3 = winFor(r, "w3");
      return {
        creativeId: String(r.id),
        name: String(r.name),
        productName: String(r.product_name),
        type: String(r.type) as CreativeType,
        launchDate: String(r.eff_launch),
        derived: r.derived === true || r.derived === "t",
        daysSinceLaunch: Number(r.days_since ?? 0),
        w1,
        w2,
        w3,
      };
    })
    .filter((r) => r.w1.spend + r.w2.spend + r.w3.spend > 0);
}

export const rawSql = sql;
