/**
 * Campaigns ("All Campaigns") query layer — powers the single campaigns table.
 *
 * Everything is range-bounded (the page always supplies from/to). Additive
 * metrics are summed; ratio metrics (CPA/ROAS/AOV/CTR/CPM/CvR) are weighted
 * from the sums, never averaged.
 *
 * Data note: this brand's "orders/revenue" are the platform-reported
 * `conversions` / `conversion_value` summed across platforms (the chosen
 * source of truth — there is no GA4 blended feed).
 */

import { and, between, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords, platformEnum } from "@/db/schema";
import {
  cpm as cpmSql,
  ctr as ctrSql,
  cvr as cvrSql,
  cpa as cpaSql,
  roas as roasSql,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
} from "@/lib/metrics";
import { getActiveAccountId } from "@/lib/tenant";

type Platform = (typeof platformEnum)[number];

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export interface PortfolioFilters {
  /** Required — the page defaults to the last 30 days when no range is set. */
  from: string;
  to: string;
  platforms?: Platform[];
  /** Campaign-name search (case-insensitive substring). */
  q?: string;
  includeExcluded?: boolean;
}

function baseConds(
  f: PortfolioFilters,
  range: { from: string; to: string },
  acct: string,
): SQL[] {
  const c: SQL[] = [
    eq(performanceRecords.accountId, acct),
    between(performanceRecords.date, range.from, range.to),
  ];
  if (!f.includeExcluded) {
    c.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    c.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`;
    // Match on the campaign name OR on a creative name — and when a creative
    // matches, keep the WHOLE campaign (every campaign that runs that creative),
    // not just that creative's rows. So the second arm is a campaign-level IN.
    c.push(
      or(
        ilike(performanceRecords.campaignName, like),
        sql`${performanceRecords.campaignName} IN (
          SELECT DISTINCT pr2.campaign_name
          FROM performance_records pr2
          JOIN creatives cr2 ON cr2.id = pr2.creative_id
          WHERE pr2.account_id = ${acct} AND cr2.name ILIKE ${like}
        )`,
      )!,
    );
  }
  return c;
}

// =====================================================================
// Per-campaign rows — power the campaigns table
// =====================================================================

export interface PortfolioCampaignRow {
  campaign: string;
  platforms: Platform[];
  creatives: number;
  spend: number;
  impressions: number;
  clicks: number;
  lpv: number;
  orders: number;
  revenue: number;
  cpa: number | null;
  roas: number | null;
  aov: number | null;
  ctr: number | null;
  cpm: number | null;
  cvr: number | null;
  lastDate: string | null;
}

export async function portfolioCampaigns(
  f: PortfolioFilters,
  range?: { from: string; to: string },
): Promise<PortfolioCampaignRow[]> {
  const acct = await getActiveAccountId();
  const r = range ?? { from: f.from, to: f.to };
  const rows = await db
    .select({
      campaign: performanceRecords.campaignName,
      platforms: sql<Platform[]>`array_agg(DISTINCT ${performanceRecords.platform})`,
      creatives: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      lpv: sumLandingPageViews,
      orders: sumConversions,
      revenue: sumConversionValue,
      cpa: cpaSql,
      roas: roasSql,
      aov: sql<number>`SUM(${performanceRecords.conversionValue}) / NULLIF(SUM(${performanceRecords.conversions}), 0)`,
      ctr: ctrSql,
      cpm: cpmSql,
      cvr: cvrSql,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(and(...baseConds(f, r, acct)))
    .groupBy(performanceRecords.campaignName)
    .orderBy(desc(sumSpend));
  return rows.map((row) => ({
    campaign: row.campaign,
    platforms: row.platforms ?? [],
    creatives: num(row.creatives),
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    lpv: num(row.lpv),
    orders: num(row.orders),
    revenue: num(row.revenue),
    cpa: numOrNull(row.cpa),
    roas: numOrNull(row.roas),
    aov: numOrNull(row.aov),
    ctr: numOrNull(row.ctr),
    cpm: numOrNull(row.cpm),
    cvr: numOrNull(row.cvr),
    lastDate: row.lastDate,
  }));
}
