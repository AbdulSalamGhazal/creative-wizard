import { and, asc, between, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creatives,
  parentCampaigns,
  performanceRecords,
  platformEnum,
} from "@/db/schema";
import {
  cpm,
  cpa,
  cpc,
  ctr,
  cvr,
  voc,
  roas,
  atcRate,
  apRate,
  purchaseRate,
  sumAddToCart,
  sumAddPayment,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
} from "@/lib/metrics";
import { computeDelta, prevPeriod, type Delta } from "@/lib/period";
import { ALL_PLATFORMS, PLATFORMS_WITH_CREATIVES } from "@/lib/palette";
import { CAMPAIGN_OBJECTIVES, type AdNetwork } from "@/lib/campaign";
import type { BreakdownLevel } from "@/lib/breakdown-level";
import { getActiveAccountId } from "@/lib/tenant";
import { fillDailyGaps } from "@/lib/time-series";
import { dataHorizon, resolveEntityBounds } from "@/db/queries/series-bounds";
import { numOrNull } from "@/db/queries/values";

/**
 * The "Funnel" lens: campaign-level funnel metrics — CPM, CTR, VOC, CvR — and
 * the volumes behind them (impressions → clicks → LP views → conversions).
 * Campaign‑centric, not creative‑centric: rows are keyed on the stored
 * campaign_name (the full "Campaign ➤ Adset" value, plus the platform suffix
 * for IG/FB) — same identity used everywhere else. All weighted via component
 * sums from lib/metrics.
 */

type Platform = (typeof platformEnum)[number];
type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export interface FunnelFilters {
  from: string;
  to: string;
  platforms?: Platform[];
  productIds?: string[];
  includeExcluded?: boolean;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/**
 * GOOGLE IS EXCLUDED FROM EVERY FUNNEL QUERY (phase 2, a user decision).
 *
 * Google reports no funnel steps at all — no landing-page views, no cart or
 * payment events — so the SQL guard in lib/metrics.ts already keeps it out of
 * both sides of every funnel RATE. This goes one step further and drops its
 * rows from the page entirely, so the STORY is consistent: google's purchases
 * can't sit in the conversions column while its ATC column is empty. The page
 * says so in one quiet line. All-or-nothing, derived from
 * PLATFORMS_WITH_CREATIVES — never a bare "google" literal.
 */
function whereFor(f: FunnelFilters, acct: string): SQL {
  const c: SQL[] = [
    eq(performanceRecords.accountId, acct),
    between(performanceRecords.date, f.from, f.to),
    inArray(performanceRecords.platform, [...PLATFORMS_WITH_CREATIVES]),
  ];
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
  addToCart: number;
  addPayment: number;
  conversions: number;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  atcRate: number | null;
  apRate: number | null;
  purchaseRate: number | null;
  cvr: number | null;
}

export interface FunnelOverview {
  current: FunnelTotals;
  /** The prior equal-length window's totals (for the funnel comparison shadow). */
  previous: FunnelTotals;
  deltas: {
    cpm: Delta;
    ctr: Delta;
    voc: Delta;
    atcRate: Delta;
    apRate: Delta;
    purchaseRate: Delta;
    cvr: Delta;
    spend: Delta;
    conversions: Delta;
  };
}

/** The funnel totals' columns — one block, shared by both windows. */
const totalsColumns = () => ({
  spend: sumSpend,
  impressions: sumImpressions,
  clicks: sumClicks,
  landingPageViews: sumLandingPageViews,
  addToCart: sumAddToCart,
  addPayment: sumAddPayment,
  conversions: sumConversions,
  cpm,
  ctr,
  voc,
  atcRate,
  apRate,
  purchaseRate,
  cvr,
});

type TotalsRow = { [K in keyof ReturnType<typeof totalsColumns>]: unknown };

function toTotals(r: Partial<TotalsRow> | undefined): FunnelTotals {
  return {
    spend: num(r?.spend),
    impressions: num(r?.impressions),
    clicks: num(r?.clicks),
    landingPageViews: num(r?.landingPageViews),
    addToCart: num(r?.addToCart),
    addPayment: num(r?.addPayment),
    conversions: num(r?.conversions),
    cpm: numOrNull(r?.cpm),
    ctr: numOrNull(r?.ctr),
    voc: numOrNull(r?.voc),
    atcRate: numOrNull(r?.atcRate),
    apRate: numOrNull(r?.apRate),
    purchaseRate: numOrNull(r?.purchaseRate),
    cvr: numOrNull(r?.cvr),
  };
}

/**
 * The window's totals AND the prior equal-length window's, in ONE scan
 * (2026-11): `prevPeriod` windows are adjacent, so one WHERE spans both and a
 * GROUP BY on the window label splits them — each group runs exactly the
 * `lib/metrics` fragments a query per window ran. A window with no rows has
 * no group, which reads as the same zeros/nulls an empty aggregate gave.
 */
async function totalsWithPrevious(
  f: FunnelFilters,
  prev: { from: string; to: string },
  acct: string,
): Promise<[FunnelTotals, FunnelTotals]> {
  const rows = await db
    .select({
      win: sql<string>`CASE WHEN ${performanceRecords.date} >= ${f.from} THEN 'cur' ELSE 'prev' END`.as(
        "funnel_window",
      ),
      ...totalsColumns(),
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor({ ...f, from: prev.from, to: f.to }, acct))
    .groupBy(sql`funnel_window`);
  return [
    toTotals(rows.find((r) => r.win === "cur")),
    toTotals(rows.find((r) => r.win === "prev")),
  ];
}

export async function funnelOverview(f: FunnelFilters): Promise<FunnelOverview> {
  const acct = await getActiveAccountId();
  const prev = prevPeriod(f.from, f.to);
  const [current, prior] = await totalsWithPrevious(f, prev, acct);
  return {
    current,
    previous: prior,
    deltas: {
      cpm: computeDelta(current.cpm, prior.cpm),
      ctr: computeDelta(current.ctr, prior.ctr),
      voc: computeDelta(current.voc, prior.voc),
      atcRate: computeDelta(current.atcRate, prior.atcRate),
      apRate: computeDelta(current.apRate, prior.apRate),
      purchaseRate: computeDelta(current.purchaseRate, prior.purchaseRate),
      cvr: computeDelta(current.cvr, prior.cvr),
      spend: computeDelta(current.spend, prior.spend),
      conversions: computeDelta(current.conversions, prior.conversions),
    },
  };
}

// =====================================================================
// Per-campaign funnel
// =====================================================================


export interface CampaignFunnelRow {
  /** The ad set's stored name — or, at campaign level, the campaign's name. */
  campaign: string;
  /** An ad set's platform; a campaign's first one (it lists all in `platforms`). */
  platform: Platform;
  /** The campaign's registered objective — a PK-join column (grouped by id). */
  objective: CampaignObjective;
  // ── Campaign level only (2026-11): the row is a CAMPAIGN, every ad set under
  // it summed as ONE group. Absent on an ad-set row. ──
  /** The campaign's id — the row's key (a name is unique only per network). */
  parentId?: string;
  network?: AdNetwork;
  /** Every platform it had rows on in the window, in platform order. */
  platforms?: Platform[];
  /** Every objective its ad sets carry, in vocabulary order. */
  objectives?: CampaignObjective[];
  spend: number;
  impressions: number;
  clicks: number;
  /**
   * Mid-funnel steps stay NULLABLE all the way to the UI: a platform that
   * never reported one is not a platform that measured zero. Only NULL renders
   * as "—" and keeps the row out of BOTH sides of the totals' ratios (the JS
   * mirror of the SQL guard — see `lib/funnel-totals.ts`).
   */
  landingPageViews: number | null;
  addToCart: number | null;
  addPayment: number | null;
  conversions: number;
  conversionValue: number;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  atcRate: number | null;
  apRate: number | null;
  purchaseRate: number | null;
  cvr: number | null;
  roas: number | null;
  cpa: number | null;
  cpc: number | null;
  /** The prior equal-length window's spend — the delta's own baseline; NULL
   *  when the campaign had no rows there. */
  priorSpend: number | null;
  /** The last day in the window this campaign has a record (MAX(date)). */
  lastDate: string | null;
  spendDelta: Delta;
}

/** Composite key for (platform, campaign) so the prior-window spend lines up
 *  even when the same campaign_name runs on more than one platform.
 *
 *  The separator is an INVISIBLE U+0001 (SOH) — the same convention
 *  csv/pipeline.ts uses, and deliberately not U+0000: a NUL byte makes grep
 *  treat the whole FILE as binary, so every code search over it silently
 *  returns nothing (this file was invisible to `grep` until 2026-10). It
 *  renders as nothing in diffs and editors, so use Python to edit this line
 *  — the Edit tool cannot match a control character. */
const pcKey = (platform: string, campaign: string) =>
  `${platform}${campaign}`;

async function campaignSpend(
  f: FunnelFilters,
  acct: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      campaign: campaigns.name,
      spend: sumSpend,
    })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f, acct))
    .groupBy(performanceRecords.platform, campaigns.id);
  const m = new Map<string, number>();
  for (const r of rows) m.set(pcKey(r.platform, r.campaign), num(r.spend));
  return m;
}

/** The funnel's per-row columns — one list for both levels of the row. */
const funnelRowMetrics = {
  spend: sumSpend,
  impressions: sumImpressions,
  clicks: sumClicks,
  landingPageViews: sumLandingPageViews,
  addToCart: sumAddToCart,
  addPayment: sumAddPayment,
  conversions: sumConversions,
  conversionValue: sumConversionValue,
  cpm,
  ctr,
  voc,
  atcRate,
  apRate,
  purchaseRate,
  cvr,
  roas,
  cpa,
  cpc,
};

/** A campaign's platforms / objectives, read off `array_agg`, in house order. */
const inPlatformOrder = (ps: readonly string[] | null): Platform[] =>
  ALL_PLATFORMS.filter((p) => (ps ?? []).includes(p));
const inObjectiveOrder = (os: readonly string[] | null): CampaignObjective[] =>
  CAMPAIGN_OBJECTIVES.filter((o) => (os ?? []).includes(o));

/**
 * The funnel table at CAMPAIGN level (2026-11): one row per campaign (a
 * `parent_campaigns` row), every record of every ad set under it as ONE
 * group — so each rate is weighted over the campaign's own component sums,
 * never a roll-up of its ad sets' rates. A Meta campaign is one row covering
 * Instagram and Facebook. An ad set with no campaign yet is left out (the
 * Campaigns list's rule).
 */
async function parentCampaignFunnel(f: FunnelFilters, acct: string): Promise<CampaignFunnelRow[]> {
  const prev = prevPeriod(f.from, f.to);
  const base = (filters: FunnelFilters) => whereFor(filters, acct);
  const [rows, priorRows] = await Promise.all([
    db
      .select({
        parentId: parentCampaigns.id,
        campaign: parentCampaigns.name,
        network: parentCampaigns.network,
        platforms: sql<string[] | null>`array_agg(DISTINCT ${performanceRecords.platform})`,
        objectives: sql<string[] | null>`array_agg(DISTINCT ${campaigns.objective})`,
        ...funnelRowMetrics,
        lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .innerJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
      .where(base(f))
      .groupBy(parentCampaigns.id, parentCampaigns.name, parentCampaigns.network)
      .orderBy(desc(sumSpend)),
    db
      .select({ parentId: parentCampaigns.id, spend: sumSpend })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .innerJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
      .where(base({ ...f, from: prev.from, to: prev.to }))
      .groupBy(parentCampaigns.id),
  ]);
  const priorSpend = new Map(priorRows.map((r) => [r.parentId, num(r.spend)]));

  return rows.map((r) => {
    const prior = priorSpend.get(r.parentId) ?? null;
    const platforms = inPlatformOrder(r.platforms);
    const objectives = inObjectiveOrder(r.objectives);
    return {
      campaign: r.campaign,
      parentId: r.parentId,
      network: r.network,
      platforms,
      objectives,
      // A grouped row always has ≥ 1 platform; the fallback only satisfies the type.
      platform: (platforms[0] ?? PLATFORMS_WITH_CREATIVES[0])!,
      objective: objectives[0] ?? CAMPAIGN_OBJECTIVES[0],
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      landingPageViews: numOrNull(r.landingPageViews),
      addToCart: numOrNull(r.addToCart),
      addPayment: numOrNull(r.addPayment),
      conversions: num(r.conversions),
      conversionValue: num(r.conversionValue),
      cpm: numOrNull(r.cpm),
      ctr: numOrNull(r.ctr),
      voc: numOrNull(r.voc),
      atcRate: numOrNull(r.atcRate),
      apRate: numOrNull(r.apRate),
      purchaseRate: numOrNull(r.purchaseRate),
      cvr: numOrNull(r.cvr),
      roas: numOrNull(r.roas),
      cpa: numOrNull(r.cpa),
      cpc: numOrNull(r.cpc),
      priorSpend: prior,
      lastDate: r.lastDate ?? null,
      spendDelta: computeDelta(num(r.spend), prior),
    };
  });
}

export async function campaignFunnel(
  f: FunnelFilters,
  /** `adset` (default — one row per ad set and platform) or `campaign`. */
  level: BreakdownLevel = "adset",
): Promise<CampaignFunnelRow[]> {
  const acct = await getActiveAccountId();
  if (level === "campaign") return parentCampaignFunnel(f, acct);
  const prev = prevPeriod(f.from, f.to);
  const [rows, priorSpend] = await Promise.all([
    db
      .select({
        platform: performanceRecords.platform,
        campaign: campaigns.name,
        objective: campaigns.objective,
        spend: sumSpend,
        impressions: sumImpressions,
        clicks: sumClicks,
        landingPageViews: sumLandingPageViews,
        addToCart: sumAddToCart,
        addPayment: sumAddPayment,
        conversions: sumConversions,
        conversionValue: sumConversionValue,
        cpm,
        ctr,
        voc,
        atcRate,
        apRate,
        purchaseRate,
        cvr,
        roas,
        cpa,
        cpc,
        lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .where(whereFor(f, acct))
      .groupBy(performanceRecords.platform, campaigns.id)
      .orderBy(desc(sumSpend)),
    campaignSpend({ ...f, from: prev.from, to: prev.to }, acct),
  ]);

  return rows.map((r) => {
    const prior = priorSpend.get(pcKey(r.platform, r.campaign)) ?? null;
    return {
      campaign: r.campaign,
      platform: r.platform as Platform,
      objective: r.objective,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      // NULL, not 0 — "never reported" is not "measured zero" (see the row docs).
      landingPageViews: numOrNull(r.landingPageViews),
      addToCart: numOrNull(r.addToCart),
      addPayment: numOrNull(r.addPayment),
      conversions: num(r.conversions),
      conversionValue: num(r.conversionValue),
      cpm: numOrNull(r.cpm),
      ctr: numOrNull(r.ctr),
      voc: numOrNull(r.voc),
      atcRate: numOrNull(r.atcRate),
      apRate: numOrNull(r.apRate),
      purchaseRate: numOrNull(r.purchaseRate),
      cvr: numOrNull(r.cvr),
      roas: numOrNull(r.roas),
      cpa: numOrNull(r.cpa),
      cpc: numOrNull(r.cpc),
      priorSpend: prior,
      lastDate: r.lastDate ?? null,
      spendDelta: computeDelta(num(r.spend), prior),
    };
  });
}

// =====================================================================
// Per-platform funnel (one row per platform — for the platform comparison)
// =====================================================================

export interface PlatformFunnelRow {
  platform: Platform;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  addToCart: number;
  addPayment: number;
  conversions: number;
  /** Revenue (Σ conversion value) — same scan as the counts. */
  conversionValue: number;
  cpa: number | null;
  cpc: number | null;
  roas: number | null;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  atcRate: number | null;
  apRate: number | null;
  purchaseRate: number | null;
  cvr: number | null;
}

/**
 * The same funnel metrics as `campaignFunnel`, but grouped by platform so the
 * channels can be read side-by-side. Each platform's rates are weighted over
 * its own component sums (never an average of ratios). Ordered by spend desc.
 */
export async function platformFunnel(
  f: FunnelFilters,
): Promise<PlatformFunnelRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      landingPageViews: sumLandingPageViews,
      addToCart: sumAddToCart,
      addPayment: sumAddPayment,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      cpa,
      cpc,
      roas,
      cpm,
      ctr,
      voc,
      atcRate,
      apRate,
      purchaseRate,
      cvr,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f, acct))
    .groupBy(performanceRecords.platform)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    platform: r.platform as Platform,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    landingPageViews: num(r.landingPageViews),
    addToCart: num(r.addToCart),
    addPayment: num(r.addPayment),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    cpa: numOrNull(r.cpa),
    cpc: numOrNull(r.cpc),
    roas: numOrNull(r.roas),
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    atcRate: numOrNull(r.atcRate),
    apRate: numOrNull(r.apRate),
    purchaseRate: numOrNull(r.purchaseRate),
    cvr: numOrNull(r.cvr),
  }));
}

// =====================================================================
// Per-platform → per-campaign funnel (drill-down for the comparison table)
// =====================================================================

export interface PlatformCampaignRow {
  platform: Platform;
  /** The ad set's stored name — or, at campaign level, the campaign's name. */
  campaign: string;
  /** The campaign's registered objective — a PK-join column (grouped by id). */
  objective: CampaignObjective;
  /** Campaign level only: every objective its ad sets on this platform carry. */
  objectives?: CampaignObjective[];
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  addToCart: number;
  addPayment: number;
  conversions: number;
  /** Revenue (Σ conversion value) — same scan as the counts. */
  conversionValue: number;
  cpa: number | null;
  cpc: number | null;
  roas: number | null;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  atcRate: number | null;
  apRate: number | null;
  purchaseRate: number | null;
  cvr: number | null;
}

/**
 * One row per (platform, campaign_name) so the Platform-comparison table can
 * expand a platform into its campaigns. Same weighted funnel metrics; ordered
 * by spend desc so the biggest campaigns surface first within each platform.
 */
export async function platformCampaignFunnel(
  f: FunnelFilters,
  /** `adset` (default) or `campaign` — what a platform expands INTO. */
  level: BreakdownLevel = "adset",
): Promise<PlatformCampaignRow[]> {
  const acct = await getActiveAccountId();
  if (level === "campaign") {
    // One row per (platform, CAMPAIGN): the campaign's share ON that platform
    // — a Meta campaign sits under Instagram and under Facebook, each with
    // that platform's own sums.
    const parentRows = await db
      .select({
        platform: performanceRecords.platform,
        campaign: parentCampaigns.name,
        objectives: sql<string[] | null>`array_agg(DISTINCT ${campaigns.objective})`,
        ...funnelRowMetrics,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .innerJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
      .where(whereFor(f, acct))
      .groupBy(performanceRecords.platform, parentCampaigns.id, parentCampaigns.name)
      .having(gt(sumSpend, 0))
      .orderBy(desc(sumSpend));
    return parentRows.map((r) => {
      const objectives = inObjectiveOrder(r.objectives);
      return {
        platform: r.platform as Platform,
        campaign: r.campaign,
        objective: objectives[0] ?? CAMPAIGN_OBJECTIVES[0],
        objectives,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        landingPageViews: num(r.landingPageViews),
        addToCart: num(r.addToCart),
        addPayment: num(r.addPayment),
        conversions: num(r.conversions),
        conversionValue: num(r.conversionValue),
        cpa: numOrNull(r.cpa),
        cpc: numOrNull(r.cpc),
        roas: numOrNull(r.roas),
        cpm: numOrNull(r.cpm),
        ctr: numOrNull(r.ctr),
        voc: numOrNull(r.voc),
        atcRate: numOrNull(r.atcRate),
        apRate: numOrNull(r.apRate),
        purchaseRate: numOrNull(r.purchaseRate),
        cvr: numOrNull(r.cvr),
      };
    });
  }
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      campaign: campaigns.name,
      objective: campaigns.objective,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      landingPageViews: sumLandingPageViews,
      addToCart: sumAddToCart,
      addPayment: sumAddPayment,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      cpa,
      cpc,
      roas,
      cpm,
      ctr,
      voc,
      atcRate,
      apRate,
      purchaseRate,
      cvr,
    })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f, acct))
    .groupBy(performanceRecords.platform, campaigns.id)
    // Drop campaigns with no spend in the window — they're just noise in the
    // breakdown (and would inflate the per-platform campaign count).
    .having(gt(sumSpend, 0))
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    platform: r.platform as Platform,
    campaign: r.campaign,
    objective: r.objective,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    landingPageViews: num(r.landingPageViews),
    addToCart: num(r.addToCart),
    addPayment: num(r.addPayment),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    cpa: numOrNull(r.cpa),
    cpc: numOrNull(r.cpc),
    roas: numOrNull(r.roas),
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    atcRate: numOrNull(r.atcRate),
    apRate: numOrNull(r.apRate),
    purchaseRate: numOrNull(r.purchaseRate),
    cvr: numOrNull(r.cvr),
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
  atcRate: number | null;
  apRate: number | null;
  purchaseRate: number | null;
  cvr: number | null;
}

const FUNNEL_RATE_KEYS = [
  "cpm",
  "ctr",
  "voc",
  "atcRate",
  "apRate",
  "purchaseRate",
  "cvr",
] as const;

/**
 * First-ever record date for the funnel's filter set, unbounded by the window
 * (the same conditions as `whereFor` minus the date range) — the leading edge
 * anchor. Null when the filter set has never had a record.
 */
async function funnelFirstDay(
  f: FunnelFilters,
  acct: string,
): Promise<string | null> {
  const c: SQL[] = [eq(performanceRecords.accountId, acct)];
  if (!f.includeExcluded) {
    c.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    c.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.productIds && f.productIds.length > 0) {
    c.push(inArray(creatives.productId, f.productIds));
  }
  const [row] = await db
    .select({ min: sql<string | null>`MIN(${performanceRecords.date})` })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(and(...c)!);
  return row?.min ?? null;
}

export async function funnelDaily(
  f: FunnelFilters,
  opts?: { fillEdges?: boolean },
): Promise<FunnelDailyPoint[]> {
  const acct = await getActiveAccountId();
  return fillFunnelDaily(await funnelDailyRows(f, acct), f, acct, opts);
}

/**
 * The live window's daily series (edge-filled) AND the prior equal-length
 * window's (interior gaps only — the faded overlay), from ONE scan (2026-11):
 * the windows are adjacent, rows are per DAY, and a day belongs to exactly one
 * window — so one GROUP BY date over both, split by date, is the two queries'
 * rows exactly.
 */
export async function funnelDailyWithPrevious(f: FunnelFilters): Promise<{
  current: FunnelDailyPoint[];
  previous: FunnelDailyPoint[];
}> {
  const acct = await getActiveAccountId();
  const prev = prevPeriod(f.from, f.to);
  const rows = await funnelDailyRows({ ...f, from: prev.from }, acct);
  const [current, previous] = await Promise.all([
    fillFunnelDaily(rows.filter((r) => r.date >= f.from), f, acct, { fillEdges: true }),
    fillFunnelDaily(rows.filter((r) => r.date <= prev.to), { ...f, ...prev }, acct),
  ]);
  return { current, previous };
}

async function funnelDailyRows(f: FunnelFilters, acct: string): Promise<FunnelDailyPoint[]> {
  const rows = await db
    .select({
      date: performanceRecords.date,
      cpm,
      ctr,
      voc,
      atcRate,
      apRate,
      purchaseRate,
      cvr,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f, acct))
    .groupBy(performanceRecords.date)
    .orderBy(asc(performanceRecords.date));
  return rows.map((r) => ({
    date: r.date,
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    atcRate: numOrNull(r.atcRate),
    apRate: numOrNull(r.apRate),
    purchaseRate: numOrNull(r.purchaseRate),
    cvr: numOrNull(r.cvr),
  }));
}

async function fillFunnelDaily(
  points: FunnelDailyPoint[],
  f: FunnelFilters,
  acct: string,
  opts?: { fillEdges?: boolean },
): Promise<FunnelDailyPoint[]> {
  // Every funnel metric is a RATE → filled days are null so the trend line
  // BREAKS across a pause (a real 0% would be a different lie). Interior gaps
  // always; leading/trailing edge zeros only when the caller opts in (the live
  // window — not the faded previous-period overlay).
  let fillFrom: string | undefined;
  let fillTo: string | undefined;
  if (opts?.fillEdges) {
    const [firstEver, horizon] = await Promise.all([
      funnelFirstDay(f, acct),
      dataHorizon(),
    ]);
    ({ fillFrom, fillTo } = resolveEntityBounds({
      from: f.from,
      to: f.to,
      firstEver,
      horizon,
    }));
  }

  return fillDailyGaps(points as unknown as Array<Record<string, unknown>>, {
    dateKey: "date",
    additiveKeys: [],
    ratioKeys: [...FUNNEL_RATE_KEYS],
    fillFrom,
    fillTo,
  }) as unknown as FunnelDailyPoint[];
}
