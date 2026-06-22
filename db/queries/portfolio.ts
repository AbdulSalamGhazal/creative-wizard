/**
 * Portfolio ("All Campaigns") query layer — the command-center page.
 *
 * Altitude: portfolio-level allocation, trend and triage across all five
 * platforms. Everything is range-bounded (the page always supplies from/to)
 * with a period-over-period comparison window for deltas.
 *
 * Data note: this brand's "orders/revenue" are the platform-reported
 * `conversions` / `conversion_value` summed across platforms (the chosen
 * source of truth — there is no GA4 blended feed). Additive metrics are
 * summed; ratio metrics (CPA/ROAS/AOV/CTR/CPM) are weighted from the sums,
 * never averaged.
 */

import { and, asc, between, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, performanceRecords, platformEnum } from "@/db/schema";
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
import { addDays, computeDelta, prevPeriod, type Delta } from "@/lib/period";
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

export type CompareMode = "prev" | "wow" | "mom";

/** Length-preserving comparison window for the chosen mode. */
export function comparisonWindow(
  from: string,
  to: string,
  mode: CompareMode,
): { from: string; to: string } {
  if (mode === "wow") return { from: addDays(from, -7), to: addDays(to, -7) };
  if (mode === "mom") return { from: addDays(from, -30), to: addDays(to, -30) };
  return prevPeriod(from, to);
}

export const COMPARE_LABEL: Record<CompareMode, string> = {
  prev: "vs prior period",
  wow: "vs prior week",
  mom: "vs prior month",
};

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
// Derived metric helpers (weighted from sums — never average the averages)
// =====================================================================

export interface PortfolioSums {
  spend: number;
  impressions: number;
  clicks: number;
  orders: number; // conversions
  revenue: number; // conversion_value
}

export interface PortfolioMetrics extends PortfolioSums {
  cpa: number | null;
  roas: number | null;
  aov: number | null;
  ctr: number | null;
  cpm: number | null;
}

function derive(s: PortfolioSums): PortfolioMetrics {
  return {
    ...s,
    cpa: s.orders > 0 ? s.spend / s.orders : null,
    roas: s.spend > 0 ? s.revenue / s.spend : null,
    aov: s.orders > 0 ? s.revenue / s.orders : null,
    ctr: s.impressions > 0 ? s.clicks / s.impressions : null,
    cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : null,
  };
}

async function sumsFor(conds: SQL[]): Promise<PortfolioSums> {
  const [r] = await db
    .select({
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      orders: sumConversions,
      revenue: sumConversionValue,
    })
    .from(performanceRecords)
    .where(and(...conds));
  return {
    spend: num(r?.spend),
    impressions: num(r?.impressions),
    clicks: num(r?.clicks),
    orders: num(r?.orders),
    revenue: num(r?.revenue),
  };
}

// =====================================================================
// 1. Scorecard KPIs with period-over-period deltas
// =====================================================================

export type PortfolioKpiKey =
  | "spend"
  | "orders"
  | "revenue"
  | "cpa"
  | "roas"
  | "aov"
  | "ctr"
  | "cpm";

export interface PortfolioKpis {
  current: PortfolioMetrics;
  previous: PortfolioMetrics;
  deltas: Record<PortfolioKpiKey, Delta>;
  comparison: { from: string; to: string };
}

export async function portfolioKpis(
  f: PortfolioFilters,
  mode: CompareMode,
): Promise<PortfolioKpis> {
  const acct = await getActiveAccountId();
  const cmp = comparisonWindow(f.from, f.to, mode);
  const [curS, prevS] = await Promise.all([
    sumsFor(baseConds(f, { from: f.from, to: f.to }, acct)),
    sumsFor(baseConds(f, cmp, acct)),
  ]);
  const current = derive(curS);
  const previous = derive(prevS);
  const keys: PortfolioKpiKey[] = [
    "spend",
    "orders",
    "revenue",
    "cpa",
    "roas",
    "aov",
    "ctr",
    "cpm",
  ];
  const deltas = Object.fromEntries(
    keys.map((k) => [k, computeDelta(current[k], previous[k])]),
  ) as Record<PortfolioKpiKey, Delta>;
  return { current, previous, deltas, comparison: cmp };
}

// =====================================================================
// 2. Daily trend with a server-side 7-day rolling average
// =====================================================================

export interface TrendPoint {
  date: string;
  spend: number;
  orders: number;
  revenue: number;
  cpa: number | null;
  roas: number | null;
  /** Trailing 7-day rolling averages (weighted for cpa). */
  spend7: number;
  orders7: number;
  cpa7: number | null;
}

export async function portfolioTrend(f: PortfolioFilters): Promise<TrendPoint[]> {
  const acct = await getActiveAccountId();
  // Pull 6 leading days so the rolling average is correct at the left edge.
  const lead = addDays(f.from, -6);
  const rows = await db
    .select({
      date: performanceRecords.date,
      spend: sumSpend,
      orders: sumConversions,
      revenue: sumConversionValue,
    })
    .from(performanceRecords)
    .where(and(...baseConds(f, { from: lead, to: f.to }, acct)))
    .groupBy(performanceRecords.date)
    .orderBy(asc(performanceRecords.date));

  const byDate = new Map(
    rows.map((r) => [
      r.date,
      { spend: num(r.spend), orders: num(r.orders), revenue: num(r.revenue) },
    ]),
  );

  // Build a dense day list from lead..to so rolling windows never skip gaps.
  const days: string[] = [];
  for (let d = lead; d <= f.to; d = addDays(d, 1)) days.push(d);

  const out: TrendPoint[] = [];
  for (let i = 0; i < days.length; i++) {
    const date = days[i]!;
    if (date < f.from) continue; // leading context only
    const here = byDate.get(date) ?? { spend: 0, orders: 0, revenue: 0 };

    let spend7 = 0;
    let orders7 = 0;
    let n = 0;
    for (let j = i; j > i - 7 && j >= 0; j--) {
      const dd = byDate.get(days[j]!) ?? { spend: 0, orders: 0, revenue: 0 };
      spend7 += dd.spend;
      orders7 += dd.orders;
      n++;
    }
    out.push({
      date,
      spend: here.spend,
      orders: here.orders,
      revenue: here.revenue,
      cpa: here.orders > 0 ? here.spend / here.orders : null,
      roas: here.spend > 0 ? here.revenue / here.spend : null,
      spend7: n > 0 ? spend7 / n : 0,
      orders7: n > 0 ? orders7 / n : 0,
      cpa7: orders7 > 0 ? spend7 / orders7 : null,
    });
  }
  return out;
}

// =====================================================================
// 3. Allocation: per-platform spend vs orders (share computed by caller)
// =====================================================================

export interface AllocationRow {
  platform: Platform;
  spend: number;
  orders: number;
  revenue: number;
}

export async function portfolioAllocation(
  f: PortfolioFilters,
): Promise<AllocationRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      spend: sumSpend,
      orders: sumConversions,
      revenue: sumConversionValue,
    })
    .from(performanceRecords)
    .where(and(...baseConds(f, { from: f.from, to: f.to }, acct)))
    .groupBy(performanceRecords.platform)
    .orderBy(desc(sumSpend));
  return rows.map((r) => ({
    platform: r.platform as Platform,
    spend: num(r.spend),
    orders: num(r.orders),
    revenue: num(r.revenue),
  }));
}

// =====================================================================
// 4/5/7. Per-campaign rows — power the scatter, Pareto, movers and table
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

// =====================================================================
// 6. Attention layer — movers / anomalies vs the comparison window
// =====================================================================

export type MoverType = "cpa_spike" | "crossed_target" | "spend_up_flat";

export interface MoverItem {
  campaign: string;
  type: MoverType;
  /** Spend in the current window — used to rank by materiality. */
  spend: number;
  curCpa: number | null;
  priorCpa: number | null;
  curOrders: number;
  priorOrders: number;
  /** Relative spend change vs prior (e.g. 0.3 = +30%). */
  spendDelta: number | null;
}

/** Minimum current spend for a campaign to be worth flagging. */
const MOVER_MIN_SPEND = 50;

export async function portfolioMovers(
  f: PortfolioFilters,
  mode: CompareMode,
  targetCpa: number | null,
): Promise<MoverItem[]> {
  const cmp = comparisonWindow(f.from, f.to, mode);
  const [cur, prior] = await Promise.all([
    portfolioCampaigns(f),
    portfolioCampaigns(f, cmp),
  ]);
  const priorByName = new Map(prior.map((r) => [r.campaign, r]));

  const items: MoverItem[] = [];
  for (const c of cur) {
    if (c.spend < MOVER_MIN_SPEND) continue;
    const p = priorByName.get(c.campaign);
    const spendDelta =
      p && p.spend > 0 ? (c.spend - p.spend) / p.spend : null;
    const ordersDelta =
      p && p.orders > 0 ? (c.orders - p.orders) / p.orders : null;

    const base = {
      campaign: c.campaign,
      spend: c.spend,
      curCpa: c.cpa,
      priorCpa: p?.cpa ?? null,
      curOrders: c.orders,
      priorOrders: p?.orders ?? 0,
      spendDelta,
    };

    // Crossed the target CPA from good → bad.
    if (
      targetCpa !== null &&
      p?.cpa != null &&
      c.cpa != null &&
      p.cpa <= targetCpa &&
      c.cpa > targetCpa
    ) {
      items.push({ ...base, type: "crossed_target" });
      continue;
    }
    // Big CPA increase (efficiency decay) with a real prior baseline.
    if (
      p?.cpa != null &&
      c.cpa != null &&
      p.cpa > 0 &&
      (c.cpa - p.cpa) / p.cpa >= 0.2
    ) {
      items.push({ ...base, type: "cpa_spike" });
      continue;
    }
    // Spend up materially while orders stayed flat/down.
    if (
      spendDelta !== null &&
      spendDelta >= 0.25 &&
      (ordersDelta === null || ordersDelta <= 0.05)
    ) {
      items.push({ ...base, type: "spend_up_flat" });
      continue;
    }
  }

  // Rank by materiality (current spend), cap to keep the panel actionable.
  items.sort((a, b) => b.spend - a.spend);
  return items.slice(0, 8);
}

// =====================================================================
// Timeline annotations: creative launches in range (data-driven)
// =====================================================================

export interface LaunchAnnotation {
  date: string;
  count: number;
}

export async function portfolioLaunches(
  f: PortfolioFilters,
): Promise<LaunchAnnotation[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      date: creatives.launchDate,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(creatives)
    .where(
      and(
        eq(creatives.accountId, acct),
        sql`${creatives.launchDate} IS NOT NULL`,
        between(creatives.launchDate, f.from, f.to),
      ),
    )
    .groupBy(creatives.launchDate)
    .orderBy(asc(creatives.launchDate));
  return rows
    .filter((r) => r.date)
    .map((r) => ({ date: r.date as string, count: num(r.count) }));
}
