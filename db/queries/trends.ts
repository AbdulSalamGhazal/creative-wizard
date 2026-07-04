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
  aov,
  completeRate,
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
  sumVideoViews2s,
  sumVideoViews25,
  sumVideoViews50,
  sumVideoViews75,
  sumVideoViews100,
  voc,
} from "@/lib/metrics";
import { prevPeriod } from "@/lib/period";
import { getActiveAccountId } from "@/lib/tenant";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import type { CreativeStatus } from "@/lib/creative-status";

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

/** The metric set surfaced per tag (current window or the prior one). */
export interface TagMetrics {
  creatives: number;
  // additive
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  // ratios (weighted)
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  cpm: number | null;
  cpc: number | null;
  roas: number | null;
  voc: number | null;
  hookRate: number | null;
  holdRate: number | null;
  completeRate: number | null;
  aov: number | null;
}

export interface TagRollupRow extends TagMetrics {
  tag: string;
  landingPageViews: number;
  /**
   * The same metrics for the immediately-prior equal-length window — powers
   * the table's "Vs prev" view. Null when unbounded (no range to compare).
   */
  prev: TagMetrics | null;
}

interface TagAgg {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  landingPageViews: number;
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  cpm: number | null;
  cpc: number | null;
  roas: number | null;
  voc: number | null;
  hookRate: number | null;
  holdRate: number | null;
  completeRate: number | null;
  aov: number | null;
  creatives: number;
}

/** Raw per-tag aggregates for one window. Fan-out by tag is intentional —
 *  a creative's spend counts toward each tag it carries. */
async function tagAggregates(f: TrendsFilters): Promise<Map<string, TagAgg>> {
  const acct = await getActiveAccountId();
  const conds: SQL[] = [eq(performanceRecords.accountId, acct)];
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
      revenue: sumConversionValue,
      landingPageViews: sumLandingPageViews,
      ctr,
      cvr,
      cpa,
      cpm,
      cpc,
      roas,
      voc,
      hookRate,
      holdRate,
      completeRate,
      aov,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(creativeTags, eq(creativeTags.creativeId, creatives.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(creativeTags.tag);

  const map = new Map<string, TagAgg>();
  for (const r of rows) {
    map.set(r.tag, {
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      conversions: num(r.conversions),
      revenue: num(r.revenue),
      landingPageViews: num(r.landingPageViews),
      ctr: numOrNull(r.ctr),
      cvr: numOrNull(r.cvr),
      cpa: numOrNull(r.cpa),
      cpm: numOrNull(r.cpm),
      cpc: numOrNull(r.cpc),
      roas: numOrNull(r.roas),
      voc: numOrNull(r.voc),
      hookRate: numOrNull(r.hookRate),
      holdRate: numOrNull(r.holdRate),
      completeRate: numOrNull(r.completeRate),
      aov: numOrNull(r.aov),
      creatives: num(r.creatives),
    });
  }
  return map;
}

/** Project a per-window aggregate to the surfaced metric set. */
function toTagMetrics(a: TagAgg): TagMetrics {
  return {
    creatives: a.creatives,
    spend: a.spend,
    impressions: a.impressions,
    clicks: a.clicks,
    conversions: a.conversions,
    revenue: a.revenue,
    ctr: a.ctr,
    cvr: a.cvr,
    cpa: a.cpa,
    cpm: a.cpm,
    cpc: a.cpc,
    roas: a.roas,
    voc: a.voc,
    hookRate: a.hookRate,
    holdRate: a.holdRate,
    completeRate: a.completeRate,
    aov: a.aov,
  };
}

/**
 * Per-tag rollup for Trends → By tag. Weighted metrics per tag, plus the same
 * metrics for the immediately-prior equal-length window (when a date range is
 * set) so the table can render its rank / vs-average / vs-previous views.
 */
export async function tagRollup(f: TrendsFilters): Promise<TagRollupRow[]> {
  const bounded = Boolean(f.from && f.to);
  const current = await tagAggregates(f);

  let prevMap = new Map<string, TagAgg>();
  if (bounded) {
    const prev = prevPeriod(f.from!, f.to!);
    prevMap = await tagAggregates({ ...f, from: prev.from, to: prev.to });
  }

  const rows: TagRollupRow[] = [];
  for (const [tag, c] of current) {
    const p = prevMap.get(tag);
    rows.push({
      tag,
      ...toTagMetrics(c),
      landingPageViews: c.landingPageViews,
      prev: p ? toTagMetrics(p) : null,
    });
  }
  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}

// =====================================================================
// By tag × platform — powers the platform-comparison section
// =====================================================================

export interface TagPlatformRow extends TagMetrics {
  platform: Platform;
  tag: string;
}

/**
 * Tag metrics broken out per platform (group by platform, tag). Same fan-out
 * as the blended rollup — a creative's spend counts toward each tag it carries
 * — but kept per platform so the UI can rank the top tags within each channel.
 */
export async function tagByPlatform(f: TrendsFilters): Promise<TagPlatformRow[]> {
  const acct = await getActiveAccountId();
  const conds: SQL[] = [eq(performanceRecords.accountId, acct)];
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
      platform: performanceRecords.platform,
      tag: creativeTags.tag,
      creatives: sql<number>`COUNT(DISTINCT ${creatives.id})`,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      revenue: sumConversionValue,
      ctr,
      cvr,
      cpa,
      cpm,
      cpc,
      roas,
      voc,
      hookRate,
      holdRate,
      completeRate,
      aov,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(creativeTags, eq(creativeTags.creativeId, creatives.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(performanceRecords.platform, creativeTags.tag);

  return rows.map((r) => ({
    platform: r.platform as Platform,
    tag: r.tag,
    creatives: num(r.creatives),
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    revenue: num(r.revenue),
    ctr: numOrNull(r.ctr),
    cvr: numOrNull(r.cvr),
    cpa: numOrNull(r.cpa),
    cpm: numOrNull(r.cpm),
    cpc: numOrNull(r.cpc),
    roas: numOrNull(r.roas),
    voc: numOrNull(r.voc),
    hookRate: numOrNull(r.hookRate),
    holdRate: numOrNull(r.holdRate),
    completeRate: numOrNull(r.completeRate),
    aov: numOrNull(r.aov),
  }));
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

  const acct = await getActiveAccountId();
  const conds: SQL[] = [eq(performanceRecords.accountId, acct)];
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
// Video diagnostics
// =====================================================================

/** Raw retention funnel counts for one video (or the portfolio aggregate). */
export interface VideoFunnel {
  impressions: number;
  v2s: number; // 2-second "hook" plays
  v25: number;
  v50: number;
  v75: number;
  v100: number; // completions
}

export interface VideoDiagnosticRow extends VideoFunnel {
  creativeId: string;
  name: string;
  productName: string;
  status: CreativeStatus;
  spend: number;
  clicks: number;
  conversions: number;
  revenue: number;
  // Funnel rates (null when the denominator is zero)
  hookRate: number | null; // 2s ÷ impressions — does the open stop the scroll
  ret25: number | null; // 25% ÷ 2s
  holdRate: number | null; // 50% ÷ 2s — does it hold past the midpoint
  ret75: number | null; // 75% ÷ 2s
  completeRate: number | null; // 100% ÷ 2s — do they finish
  // Outcome + efficiency
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  costPerHook: number | null; // spend ÷ 2s plays
  costPerCompletion: number | null; // spend ÷ completions
}

export interface VideoDiagnosticsResult {
  rows: VideoDiagnosticRow[];
  /** Portfolio funnel — sum across all matched videos (disjoint, so exact). */
  aggregate: VideoFunnel;
  videoCount: number;
  medianHookRate: number | null;
  medianHoldRate: number | null;
  medianCompleteRate: number | null;
}

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

/**
 * Per-video retention funnel (impressions → 2s → 25/50/75/100%) with derived
 * hook/hold/complete rates, conversion outcome, and cost-per-attention, plus
 * the portfolio aggregate funnel and medians. Restricted to video creatives.
 */
export async function videoDiagnostics(
  f: TrendsFilters,
): Promise<VideoDiagnosticsResult> {
  const acct = await getActiveAccountId();
  const conds: SQL[] = [
    eq(performanceRecords.accountId, acct),
    eq(creatives.type, "video"),
  ];
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
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      revenue: sumConversionValue,
      lpv: sumLandingPageViews,
      v2s: sumVideoViews2s,
      v25: sumVideoViews25,
      v50: sumVideoViews50,
      v75: sumVideoViews75,
      v100: sumVideoViews100,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(and(...conds))
    .groupBy(creatives.id, creatives.name, products.name)
    .orderBy(desc(sumSpend));

  // Attach the dynamic general status for each video creative.
  const sMap = await creativeStatusMap(rows.map((r) => r.creativeId));

  const rate = (a: number, b: number): number | null => (b > 0 ? a / b : null);

  const out: VideoDiagnosticRow[] = rows.map((r) => {
    const impressions = num(r.impressions);
    const v2s = num(r.v2s);
    const v25 = num(r.v25);
    const v50 = num(r.v50);
    const v75 = num(r.v75);
    const v100 = num(r.v100);
    const spend = num(r.spend);
    const clicks = num(r.clicks);
    const conversions = num(r.conversions);
    const revenue = num(r.revenue);
    const lpv = num(r.lpv);
    return {
      creativeId: r.creativeId,
      name: r.name,
      productName: r.productName,
      status: statusFor(sMap, r.creativeId).general,
      impressions, v2s, v25, v50, v75, v100,
      spend, clicks, conversions, revenue,
      hookRate: rate(v2s, impressions),
      ret25: rate(v25, v2s),
      holdRate: rate(v50, v2s),
      ret75: rate(v75, v2s),
      completeRate: rate(v100, v2s),
      ctr: rate(clicks, impressions),
      cvr: rate(conversions, lpv),
      cpa: rate(spend, conversions),
      roas: rate(revenue, spend),
      costPerHook: rate(spend, v2s),
      costPerCompletion: rate(spend, v100),
    };
  });

  const aggregate: VideoFunnel = out.reduce(
    (a, r) => ({
      impressions: a.impressions + r.impressions,
      v2s: a.v2s + r.v2s,
      v25: a.v25 + r.v25,
      v50: a.v50 + r.v50,
      v75: a.v75 + r.v75,
      v100: a.v100 + r.v100,
    }),
    { impressions: 0, v2s: 0, v25: 0, v50: 0, v75: 0, v100: 0 },
  );

  return {
    rows: out,
    aggregate,
    videoCount: out.length,
    medianHookRate: median(out.map((r) => r.hookRate ?? NaN)),
    medianHoldRate: median(out.map((r) => r.holdRate ?? NaN)),
    medianCompleteRate: median(out.map((r) => r.completeRate ?? NaN)),
  };
}
