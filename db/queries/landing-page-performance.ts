import { and, asc, between, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { PLATFORMS_WITH_CREATIVES } from "@/lib/palette";
import {
  creatives,
  landingPages,
  performanceRecords,
  products,
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
 * Trends → LPs: ad performance grouped by PRODUCT, then by the LANDING PAGE a
 * record was sent to. `performance_records.landing_page_id` is set at upload
 * time from the ad name's ` @code` suffix (lib/landing-code.ts); NULL means
 * the ad carried no code and sent traffic to the product's own page — that
 * bucket is a row of its own in each product's group, never dropped and never
 * merged, so a product's own page and its landing pages compare like with
 * like (user decision, 2026-10-29).
 *
 * WHICH PRODUCT a record counts under: a landing-page record counts under the
 * PAGE's product (`landing_pages.product_id`; uploads refuse a creative of
 * another product, E024, so the two agree for everything imported since —
 * and a pre-backfill page with no product groups under "No product"); a
 * product-page record counts under its creative's product. A product with no
 * registered landing page has nothing to compare and is left off the page
 * entirely (user decision) — Dashboard and Ads carry its totals.
 *
 * CREATIVE-LEVEL SCOPE (google): like its Trends siblings this page compares
 * platforms, and the user decided (2026-10-25) it excludes google — derived
 * from `PLATFORMS_WITH_CREATIVES`, never a "google" literal. The caller's own
 * platform filter applies on top, so a forged `?platforms=google` returns
 * nothing rather than google.
 */

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** The product a record counts under (see the module comment). */
const productOf = sql<string | null>`CASE WHEN ${performanceRecords.landingPageId} IS NULL THEN ${creatives.productId} ELSE ${landingPages.productId} END`;

export interface LandingPageFilters {
  from?: string;
  to?: string;
  platforms?: Platform[];
  productIds?: string[];
  includeExcluded?: boolean;
}

export interface LandingPageRollupRow {
  /** The product the row counts under — null only for a page with no product. */
  productId: string | null;
  productName: string | null;
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
 * One day of one (product, landing page): the COMPONENT SUMS only. The chart
 * derives each day's ratio (ROAS, CTR, CvR, CPA, CPC) from these — a day's
 * ratio from that day's sums, never an average of anything — so the query
 * stays a plain grouped scan whichever metric is picked.
 */
export interface LandingPageDailyRow {
  /** `YYYY-MM-DD`. */
  date: string;
  productId: string | null;
  landingPageId: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
}

/**
 * The WHERE every query here shares: tenant, platform scope, range, Excluded,
 * filters — and the "has something to compare" rule: a product-page record
 * counts only when its product has at least one registered landing page.
 */
async function conditions(f: LandingPageFilters, acct: string): Promise<SQL[]> {
  const conds: SQL[] = [
    eq(performanceRecords.accountId, acct),
    inArray(performanceRecords.platform, [...PLATFORMS_WITH_CREATIVES]),
    or(
      isNotNull(performanceRecords.landingPageId),
      sql`EXISTS (SELECT 1 FROM ${landingPages} AS lp_any WHERE lp_any.account_id = ${acct} AND lp_any.product_id = ${creatives.productId})`,
    )!,
  ];
  if (f.from && f.to) conds.push(between(performanceRecords.date, f.from, f.to));
  if (!f.includeExcluded) {
    conds.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.productIds && f.productIds.length > 0) {
    // The product the row COUNTS under, so a filtered product's group arrives
    // whole: its own page and every page registered under it.
    conds.push(inArray(productOf, f.productIds));
  }
  return conds;
}

/**
 * One row per (product, landing page) — the NULL page being the product's
 * own — over the filtered records, or one per (product, landing page,
 * platform) with `byPlatform`. Only groups with at least one record in range
 * appear; a registered page nothing ran to is not a row of zeros. The landing
 * page and the product are LEFT-joined so the NULL bucket keeps its records,
 * and the page join is account-scoped like every tenant read.
 */
export async function landingPageRollup(
  f: LandingPageFilters,
  opts: { byPlatform?: boolean } = {},
): Promise<LandingPageRollupRow[]> {
  const byPlatform = opts.byPlatform === true;
  const acct = await getActiveAccountId();
  const conds = await conditions(f, acct);

  const rows = await db
    .select({
      productId: productOf,
      productName: products.name,
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
    .leftJoin(products, eq(products.id, productOf))
    .where(and(...conds))
    .groupBy(
      productOf,
      products.name,
      performanceRecords.landingPageId,
      landingPages.name,
      landingPages.code,
      landingPages.url,
      ...(byPlatform ? [performanceRecords.platform] : []),
    );

  const out: LandingPageRollupRow[] = rows.map((r) => ({
    productId: r.productId ?? null,
    productName: r.productName ?? null,
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

  // Biggest spender first; the table re-groups by product on the client.
  out.sort((a, b) => b.spend - a.spend);
  return out;
}

/**
 * Per-day component sums per (product, landing page), the NULL bucket
 * included, for the over-time chart. Days a page had no record are simply
 * absent — the chart fills them as zero inside the range for an additive
 * metric (an absent day IS zero) and as a gap for a ratio (nothing to divide).
 */
export async function landingPageDaily(
  f: LandingPageFilters,
): Promise<LandingPageDailyRow[]> {
  const acct = await getActiveAccountId();
  const conds = await conditions(f, acct);
  const rows = await db
    .select({
      date: performanceRecords.date,
      productId: productOf,
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
    .leftJoin(
      landingPages,
      and(
        eq(landingPages.id, performanceRecords.landingPageId),
        eq(landingPages.accountId, acct),
      ),
    )
    .where(and(...conds))
    .groupBy(performanceRecords.date, productOf, performanceRecords.landingPageId)
    .orderBy(asc(performanceRecords.date));
  return rows.map((r) => ({
    date: String(r.date),
    productId: r.productId ?? null,
    landingPageId: r.landingPageId ?? null,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    landingPageViews: num(r.landingPageViews),
  }));
}
