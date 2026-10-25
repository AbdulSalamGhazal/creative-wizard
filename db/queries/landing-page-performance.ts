import { and, asc, between, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { PLATFORMS_WITH_CREATIVES } from "@/lib/palette";
import {
  creatives,
  landingPages,
  performanceRecords,
  type platformEnum,
} from "@/db/schema";
import {
  cpa,
  cpc,
  cpm,
  ctr,
  cvr,
  roas,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
} from "@/lib/metrics";
import { getActiveAccountId } from "@/lib/tenant";
import { numOrNull } from "@/db/queries/values";

type Platform = (typeof platformEnum)[number];

/**
 * Trends → LPs: ad performance grouped by the LANDING PAGE a record was sent
 * to. `performance_records.landing_page_id` is set at upload time from the
 * ad name's ` @code` suffix (lib/landing-code.ts); NULL means the ad carried
 * no code and sent traffic to the product's own page — that bucket is a row
 * of its own here, never dropped and never merged.
 *
 * CREATIVE-LEVEL SCOPE (google): like its Trends siblings this page compares
 * platforms, and the user decided (2026-10-25) it excludes google — derived
 * from `PLATFORMS_WITH_CREATIVES`, never a "google" literal. The caller's own
 * platform filter applies on top, so a forged `?platforms=google` returns
 * nothing rather than google.
 */

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export interface LandingPageFilters {
  from?: string;
  to?: string;
  platforms?: Platform[];
  productIds?: string[];
  includeExcluded?: boolean;
}

export interface LandingPageRollupRow {
  /** NULL = the product's own page (an ad name with no ` @code`). */
  landingPageId: string | null;
  name: string | null;
  /** Without the `@`. */
  code: string | null;
  url: string | null;
  /** Set only when the rollup is split by platform. */
  platform: Platform | null;
  /** Distinct creatives with at least one record in the group. */
  creatives: number;
  // additive
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
  // ratios (weighted via component sums — lib/metrics)
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
  cvr: number | null;
}

/**
 * One day of one landing page: the COMPONENT SUMS only. The chart derives
 * each day's ratio (ROAS, CTR, CvR, CPA, CPC) from these — a day's ratio from
 * that day's sums, never an average of anything — so the query stays a plain
 * grouped scan whichever metric is picked.
 */
export interface LandingPageDailyRow {
  /** `YYYY-MM-DD`. */
  date: string;
  landingPageId: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
}

/** The WHERE every query here shares: tenant, platform scope, range, Excluded, filters. */
async function conditions(f: LandingPageFilters): Promise<SQL[]> {
  const acct = await getActiveAccountId();
  const conds: SQL[] = [
    eq(performanceRecords.accountId, acct),
    inArray(performanceRecords.platform, [...PLATFORMS_WITH_CREATIVES]),
  ];
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
  return conds;
}

/**
 * One row per landing page (plus the NULL bucket) over the filtered records —
 * or one per (landing page, platform) with `byPlatform`. Only groups with at
 * least one record in range appear; a registered page nothing ran to is not
 * a row of zeros. The landing page is LEFT-joined so the NULL bucket keeps
 * its records, and the join is account-scoped like every tenant read.
 */
export async function landingPageRollup(
  f: LandingPageFilters,
  opts: { byPlatform?: boolean } = {},
): Promise<LandingPageRollupRow[]> {
  const byPlatform = opts.byPlatform === true;
  const acct = await getActiveAccountId();
  const conds = await conditions(f);

  const rows = await db
    .select({
      landingPageId: performanceRecords.landingPageId,
      name: landingPages.name,
      code: landingPages.code,
      url: landingPages.url,
      platform: byPlatform
        ? sql<string | null>`${performanceRecords.platform}`
        : sql<string | null>`NULL`,
      creatives: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})`,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      landingPageViews: sumLandingPageViews,
      ctr,
      cpc,
      cpm,
      cpa,
      roas,
      cvr,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .leftJoin(
      landingPages,
      and(
        eq(landingPages.id, performanceRecords.landingPageId),
        eq(landingPages.accountId, acct),
      ),
    )
    .where(and(...conds))
    .groupBy(
      performanceRecords.landingPageId,
      landingPages.name,
      landingPages.code,
      landingPages.url,
      ...(byPlatform ? [performanceRecords.platform] : []),
    );

  const out: LandingPageRollupRow[] = rows.map((r) => ({
    landingPageId: r.landingPageId ?? null,
    name: r.name ?? null,
    code: r.code ?? null,
    url: r.url ?? null,
    platform: (r.platform as Platform | null) ?? null,
    creatives: num(r.creatives),
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    landingPageViews: num(r.landingPageViews),
    ctr: numOrNull(r.ctr),
    cpc: numOrNull(r.cpc),
    cpm: numOrNull(r.cpm),
    cpa: numOrNull(r.cpa),
    roas: numOrNull(r.roas),
    cvr: numOrNull(r.cvr),
  }));

  // Biggest spender first; the product page sorts by its spend like any row.
  out.sort((a, b) => b.spend - a.spend);
  return out;
}

/**
 * Per-day component sums per landing page (NULL bucket included), for the
 * over-time chart. Days a page had no record are simply absent — the chart
 * fills them as zero inside the range for an additive metric (an absent day
 * IS zero) and as a gap for a ratio (nothing to divide).
 */
export async function landingPageDaily(
  f: LandingPageFilters,
): Promise<LandingPageDailyRow[]> {
  const conds = await conditions(f);
  const rows = await db
    .select({
      date: performanceRecords.date,
      landingPageId: performanceRecords.landingPageId,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      landingPageViews: sumLandingPageViews,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(and(...conds))
    .groupBy(performanceRecords.date, performanceRecords.landingPageId)
    .orderBy(asc(performanceRecords.date));
  return rows.map((r) => ({
    date: String(r.date),
    landingPageId: r.landingPageId ?? null,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    landingPageViews: num(r.landingPageViews),
  }));
}
