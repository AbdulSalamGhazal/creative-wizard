import { and, asc, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, performanceRecords, platformEnum } from "@/db/schema";
import {
  cpm,
  ctr,
  cvr,
  voc,
  sumClicks,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
} from "@/lib/metrics";
import { computeDelta, prevPeriod, type Delta } from "@/lib/period";

/**
 * The "Funnel" lens: campaign-level funnel metrics — CPM, CTR, VOC, CvR — and
 * the volumes behind them (impressions → clicks → LP views → conversions).
 * Campaign‑centric, not creative‑centric: rows roll up by the campaign root
 * (the part before " ➤ adset"), so adsets and placements of one campaign
 * combine. All weighted via component sums from lib/metrics.
 */

type Platform = (typeof platformEnum)[number];

export interface FunnelFilters {
  from: string;
  to: string;
  platforms?: Platform[];
  productIds?: string[];
  includeExcluded?: boolean;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function whereFor(f: FunnelFilters): SQL {
  const c: SQL[] = [between(performanceRecords.date, f.from, f.to)];
  if (!f.includeExcluded) {
    c.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    c.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.productIds && f.productIds.length > 0) {
    c.push(inArray(creatives.productId, f.productIds));
  }
  return and(...c)!;
}

// =====================================================================
// Overview totals (+ period-over-period deltas)
// =====================================================================

export interface FunnelTotals {
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  conversions: number;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
}

export interface FunnelOverview {
  current: FunnelTotals;
  deltas: {
    cpm: Delta;
    ctr: Delta;
    voc: Delta;
    cvr: Delta;
    spend: Delta;
    conversions: Delta;
  };
}

async function totals(f: FunnelFilters): Promise<FunnelTotals> {
  const [r] = await db
    .select({
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      landingPageViews: sumLandingPageViews,
      conversions: sumConversions,
      cpm,
      ctr,
      voc,
      cvr,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f));
  return {
    spend: num(r?.spend),
    impressions: num(r?.impressions),
    clicks: num(r?.clicks),
    landingPageViews: num(r?.landingPageViews),
    conversions: num(r?.conversions),
    cpm: numOrNull(r?.cpm),
    ctr: numOrNull(r?.ctr),
    voc: numOrNull(r?.voc),
    cvr: numOrNull(r?.cvr),
  };
}

export async function funnelOverview(f: FunnelFilters): Promise<FunnelOverview> {
  const prev = prevPeriod(f.from, f.to);
  const [current, prior] = await Promise.all([
    totals(f),
    totals({ ...f, from: prev.from, to: prev.to }),
  ]);
  return {
    current,
    deltas: {
      cpm: computeDelta(current.cpm, prior.cpm),
      ctr: computeDelta(current.ctr, prior.ctr),
      voc: computeDelta(current.voc, prior.voc),
      cvr: computeDelta(current.cvr, prior.cvr),
      spend: computeDelta(current.spend, prior.spend),
      conversions: computeDelta(current.conversions, prior.conversions),
    },
  };
}

// =====================================================================
// Per-campaign funnel
// =====================================================================

/** Campaign root = the part before " ➤ adset" (so adsets/placements combine). */
const campaignRoot = sql<string>`split_part(${performanceRecords.campaignName}, ' ➤ ', 1)`;

export interface CampaignFunnelRow {
  campaign: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  conversions: number;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
  spendDelta: Delta;
}

async function campaignSpend(f: FunnelFilters): Promise<Map<string, number>> {
  const rows = await db
    .select({ campaign: campaignRoot, spend: sumSpend })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f))
    .groupBy(campaignRoot);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.campaign, num(r.spend));
  return m;
}

export async function campaignFunnel(
  f: FunnelFilters,
): Promise<CampaignFunnelRow[]> {
  const prev = prevPeriod(f.from, f.to);
  const [rows, priorSpend] = await Promise.all([
    db
      .select({
        campaign: campaignRoot,
        spend: sumSpend,
        impressions: sumImpressions,
        clicks: sumClicks,
        landingPageViews: sumLandingPageViews,
        conversions: sumConversions,
        cpm,
        ctr,
        voc,
        cvr,
      })
      .from(performanceRecords)
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .where(whereFor(f))
      .groupBy(campaignRoot)
      .orderBy(desc(sumSpend)),
    campaignSpend({ ...f, from: prev.from, to: prev.to }),
  ]);

  return rows.map((r) => ({
    campaign: r.campaign,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    landingPageViews: num(r.landingPageViews),
    conversions: num(r.conversions),
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    cvr: numOrNull(r.cvr),
    spendDelta: computeDelta(num(r.spend), priorSpend.get(r.campaign) ?? null),
  }));
}

// =====================================================================
// Daily series (blended rates over the window) for the trend chart
// =====================================================================

export interface FunnelDailyPoint {
  date: string;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
}

export async function funnelDaily(f: FunnelFilters): Promise<FunnelDailyPoint[]> {
  const rows = await db
    .select({ date: performanceRecords.date, cpm, ctr, voc, cvr })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f))
    .groupBy(performanceRecords.date)
    .orderBy(asc(performanceRecords.date));
  return rows.map((r) => ({
    date: r.date,
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    cvr: numOrNull(r.cvr),
  }));
}
