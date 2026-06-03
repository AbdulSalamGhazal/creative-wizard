import { and, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creatives,
  creativeTags,
  performanceRecords,
  platformEnum,
  products,
} from "@/db/schema";
import {
  ctr,
  cpa,
  cpc,
  cvr,
  hookRate,
  holdRate,
  roas,
  scopedMetrics,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumSpend,
} from "@/lib/metrics";
import { computeDelta, prevPeriod, type Delta } from "@/lib/period";

type Platform = (typeof platformEnum)[number];

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export interface TrendsFilters {
  from?: string;
  to?: string;
  platforms?: Platform[];
  productIds?: string[];
  includeExcluded?: boolean;
}

// =====================================================================
// By tag
// =====================================================================

export interface TagRollupRow {
  tag: string;
  creatives: number;
  spend: number;
  impressions: number;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
  cvr: number | null;
  hookRate: number | null;
  spendDelta: Delta;
}

/** Raw per-tag aggregates for one window. Fan-out by tag is intentional —
 *  a creative's spend counts toward each tag it carries. */
async function tagAggregates(
  f: TrendsFilters,
): Promise<Map<string, { spend: number; impressions: number; clicks: number; conversions: number | null; ctr: number | null; cpa: number | null; roas: number | null; cvr: number | null; hookRate: number | null; creatives: number }>> {
  const conds: SQL[] = [];
  if (f.from && f.to) conds.push(between(performanceRecords.date, f.from, f.to));
  if (!f.includeExcluded) conds.push(eq(performanceRecords.excludedFromAggregates, false));
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.productIds && f.productIds.length > 0) {
    conds.push(inArray(creatives.productId, f.productIds));
  }

  const rows = await db
    .select({
      tag: creativeTags.tag,
      creatives: sql<number>`COUNT(DISTINCT ${creatives.id})`,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      ctr,
      cpa,
      roas,
      cvr,
      hookRate,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(creativeTags, eq(creativeTags.creativeId, creatives.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(creativeTags.tag);

  const map = new Map<string, ReturnType<typeof rowShape>>();
  function rowShape(r: (typeof rows)[number]) {
    return {
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      conversions: numOrNull(r.conversions),
      ctr: numOrNull(r.ctr),
      cpa: numOrNull(r.cpa),
      roas: numOrNull(r.roas),
      cvr: numOrNull(r.cvr),
      hookRate: numOrNull(r.hookRate),
      creatives: num(r.creatives),
    };
  }
  for (const r of rows) map.set(r.tag, rowShape(r));
  return map;
}

/**
 * Per-tag rollup for Trends → By tag. Weighted metrics per tag, plus a
 * spend delta against the immediately-prior equal-length window when a
 * date range is set.
 */
export async function tagRollup(f: TrendsFilters): Promise<TagRollupRow[]> {
  const current = await tagAggregates(f);

  let prevMap = new Map<string, { spend: number }>();
  if (f.from && f.to) {
    const prev = prevPeriod(f.from, f.to);
    prevMap = await tagAggregates({ ...f, from: prev.from, to: prev.to });
  }

  const rows: TagRollupRow[] = [];
  for (const [tag, c] of current) {
    const prevSpend = prevMap.get(tag)?.spend ?? null;
    rows.push({
      tag,
      creatives: c.creatives,
      spend: c.spend,
      impressions: c.impressions,
      ctr: c.ctr,
      cpa: c.cpa,
      roas: c.roas,
      cvr: c.cvr,
      hookRate: c.hookRate,
      spendDelta:
        f.from && f.to ? computeDelta(c.spend, prevSpend) : { pct: null, mode: "absent" },
    });
  }
  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}

// =====================================================================
// By type (video / image / slides), optionally split by platform
// =====================================================================

export interface TypeRollupRow {
  type: "video" | "image" | "slides";
  /** null = blended across all platforms; otherwise the platform for this row. */
  platform: Platform | null;
  creatives: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
  cvr: number | null;
}

const TYPE_ORDER: Record<TypeRollupRow["type"], number> = {
  video: 0,
  image: 1,
  slides: 2,
};

/**
 * Performance rolled up by creative type (video/image/slides). With
 * `byPlatform`, it additionally splits each type by platform — every
 * performance row belongs to exactly one creative (one type), so there's no
 * fan-out and the weighted metrics are exact. Sorted type-first, then by spend.
 */
export async function typeRollup(
  f: TrendsFilters,
  opts: { byPlatform?: boolean } = {},
): Promise<TypeRollupRow[]> {
  const byPlatform = opts.byPlatform === true;

  const conds: SQL[] = [];
  if (f.from && f.to) conds.push(between(performanceRecords.date, f.from, f.to));
  if (!f.includeExcluded) {
    conds.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.productIds && f.productIds.length > 0) {
    conds.push(inArray(creatives.productId, f.productIds));
  }

  const rows = await db
    .select({
      type: creatives.type,
      platform: byPlatform
        ? sql<string | null>`${performanceRecords.platform}`
        : sql<string | null>`NULL`,
      creatives: sql<number>`COUNT(DISTINCT ${creatives.id})`,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      ctr,
      cpc,
      cpa,
      roas,
      cvr,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(
      ...(byPlatform
        ? [creatives.type, performanceRecords.platform]
        : [creatives.type]),
    );

  const out: TypeRollupRow[] = rows.map((r) => ({
    type: r.type as TypeRollupRow["type"],
    platform: (r.platform as Platform | null) ?? null,
    creatives: num(r.creatives),
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    ctr: numOrNull(r.ctr),
    cpc: numOrNull(r.cpc),
    cpa: numOrNull(r.cpa),
    roas: numOrNull(r.roas),
    cvr: numOrNull(r.cvr),
  }));

  out.sort((a, b) =>
    a.type !== b.type ? TYPE_ORDER[a.type] - TYPE_ORDER[b.type] : b.spend - a.spend,
  );
  return out;
}

// =====================================================================
// Launches (cohort by launch_date)
// =====================================================================

export interface LaunchWindowBlock {
  spend: number;
  conversionValue: number | null;
  ctr: number | null;
  roas: number | null;
  cpa: number | null;
}

export interface LaunchReportRow {
  creativeId: string;
  name: string;
  productName: string;
  type: "video" | "image" | "slides";
  launchDate: string;
  daysSinceLaunch: number;
  first7: LaunchWindowBlock;
  first30: LaunchWindowBlock;
}

export interface LaunchCohortRow {
  month: string; // YYYY-MM
  launches: number;
  first30Spend: number;
  first30Roas: number | null;
}

export interface LaunchReportResult {
  rows: LaunchReportRow[];
  cohorts: LaunchCohortRow[];
}

/**
 * Per-creative launch report: performance in the first 7 and first 30 days
 * from each creative's launch_date, normalised so launches from different
 * months are directly comparable.
 *
 * The JOIN caps records to the 30-day window from launch; the first-7 block
 * uses a FILTER over that. Ratios are weighted (scopedMetrics / lib/metrics).
 */
export async function launchReport(): Promise<LaunchReportResult> {
  const first7 = scopedMetrics(
    sql`${performanceRecords.date} <= ${creatives.launchDate} + 6 AND ${performanceRecords.excludedFromAggregates} = false`,
  );

  const rows = await db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      productName: products.name,
      type: creatives.type,
      launchDate: creatives.launchDate,
      daysSinceLaunch: sql<number>`(CURRENT_DATE - ${creatives.launchDate})`,
      // first 7
      f7Spend: first7.spend,
      f7ConvValue: first7.conversionValue,
      f7Ctr: first7.ctr,
      f7Roas: first7.roas,
      f7Cpa: first7.cpa,
      // first 30 — all joined rows are within the 30-day window
      f30Spend: sumSpend,
      f30ConvValue: sumConversionValue,
      f30Ctr: ctr,
      f30Roas: roas,
      f30Cpa: cpa,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .leftJoin(
      performanceRecords,
      and(
        eq(performanceRecords.creativeId, creatives.id),
        sql`${performanceRecords.date} >= ${creatives.launchDate}`,
        sql`${performanceRecords.date} <= ${creatives.launchDate} + 29`,
        eq(performanceRecords.excludedFromAggregates, false),
      ),
    )
    .where(sql`${creatives.launchDate} IS NOT NULL`)
    .groupBy(
      creatives.id,
      creatives.name,
      products.name,
      creatives.type,
      creatives.launchDate,
    )
    .orderBy(desc(creatives.launchDate));

  const report: LaunchReportRow[] = rows.map((r) => ({
    creativeId: r.creativeId,
    name: r.name,
    productName: r.productName,
    type: r.type as LaunchReportRow["type"],
    launchDate: r.launchDate as string,
    daysSinceLaunch: num(r.daysSinceLaunch),
    first7: {
      spend: num(r.f7Spend),
      conversionValue: numOrNull(r.f7ConvValue),
      ctr: numOrNull(r.f7Ctr),
      roas: numOrNull(r.f7Roas),
      cpa: numOrNull(r.f7Cpa),
    },
    first30: {
      spend: num(r.f30Spend),
      conversionValue: numOrNull(r.f30ConvValue),
      ctr: numOrNull(r.f30Ctr),
      roas: numOrNull(r.f30Roas),
      cpa: numOrNull(r.f30Cpa),
    },
  }));

  // Cohort rollup by launch month — weighted first-30 ROAS from component sums.
  const byMonth = new Map<string, { launches: number; spend: number; convValue: number }>();
  for (const r of report) {
    const month = r.launchDate.slice(0, 7);
    const agg = byMonth.get(month) ?? { launches: 0, spend: 0, convValue: 0 };
    agg.launches += 1;
    agg.spend += r.first30.spend;
    agg.convValue += r.first30.conversionValue ?? 0;
    byMonth.set(month, agg);
  }
  const cohorts: LaunchCohortRow[] = [...byMonth.entries()]
    .map(([month, a]) => ({
      month,
      launches: a.launches,
      first30Spend: a.spend,
      first30Roas: a.spend > 0 ? a.convValue / a.spend : null,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  return { rows: report, cohorts };
}

// =====================================================================
// Video diagnostics
// =====================================================================

export interface VideoDiagnosticRow {
  creativeId: string;
  name: string;
  productName: string;
  status: "draft" | "active" | "paused" | "archived";
  spend: number;
  impressions: number;
  hookRate: number | null;
  holdRate: number | null;
  ctr: number | null;
}

export interface VideoDiagnosticsResult {
  rows: VideoDiagnosticRow[];
  medianHookRate: number | null;
  medianHoldRate: number | null;
}

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

/**
 * Per-video hook rate (3s/impressions) and hold rate (15s/3s), with the
 * portfolio medians for context. Restricted to video creatives.
 */
export async function videoDiagnostics(
  f: TrendsFilters,
): Promise<VideoDiagnosticsResult> {
  const conds: SQL[] = [eq(creatives.type, "video")];
  if (f.from && f.to) conds.push(between(performanceRecords.date, f.from, f.to));
  if (!f.includeExcluded) conds.push(eq(performanceRecords.excludedFromAggregates, false));
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.productIds && f.productIds.length > 0) {
    conds.push(inArray(creatives.productId, f.productIds));
  }

  const rows = await db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      productName: products.name,
      status: creatives.status,
      spend: sumSpend,
      impressions: sumImpressions,
      hookRate,
      holdRate,
      ctr,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(and(...conds))
    .groupBy(creatives.id, creatives.name, products.name, creatives.status)
    .orderBy(desc(sumSpend));

  const out: VideoDiagnosticRow[] = rows.map((r) => ({
    creativeId: r.creativeId,
    name: r.name,
    productName: r.productName,
    status: r.status as VideoDiagnosticRow["status"],
    spend: num(r.spend),
    impressions: num(r.impressions),
    hookRate: numOrNull(r.hookRate),
    holdRate: numOrNull(r.holdRate),
    ctr: numOrNull(r.ctr),
  }));

  return {
    rows: out,
    medianHookRate: median(out.map((r) => r.hookRate ?? NaN)),
    medianHoldRate: median(out.map((r) => r.holdRate ?? NaN)),
  };
}
