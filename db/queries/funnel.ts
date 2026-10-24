import { and, asc, between, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creatives,
  performanceRecords,
  platformEnum,
} from "@/db/schema";
import {
  cpm,
  cpa,
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
import { PLATFORMS_WITH_CREATIVES } from "@/lib/palette";
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

async function totals(f: FunnelFilters, acct: string): Promise<FunnelTotals> {
  const [r] = await db
    .select({
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
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(whereFor(f, acct));
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

export async function funnelOverview(f: FunnelFilters): Promise<FunnelOverview> {
  const acct = await getActiveAccountId();
  const prev = prevPeriod(f.from, f.to);
  const [current, prior] = await Promise.all([
    totals(f, acct),
    totals({ ...f, from: prev.from, to: prev.to }, acct),
  ]);
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
  campaign: string;
  platform: Platform;
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

export async function campaignFunnel(
  f: FunnelFilters,
): Promise<CampaignFunnelRow[]> {
  const acct = await getActiveAccountId();
  const prev = prevPeriod(f.from, f.to);
  const [rows, priorSpend] = await Promise.all([
    db
      .select({
        platform: performanceRecords.platform,
        campaign: campaigns.name,
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
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .where(whereFor(f, acct))
      .groupBy(performanceRecords.platform, campaigns.id)
      .orderBy(desc(sumSpend)),
    campaignSpend({ ...f, from: prev.from, to: prev.to }, acct),
  ]);

  return rows.map((r) => ({
    campaign: r.campaign,
    platform: r.platform as Platform,
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
    spendDelta: computeDelta(
      num(r.spend),
      priorSpend.get(pcKey(r.platform, r.campaign)) ?? null,
    ),
  }));
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
  cpa: number | null;
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
      cpa,
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
    cpa: numOrNull(r.cpa),
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
  campaign: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  addToCart: number;
  addPayment: number;
  conversions: number;
  cpa: number | null;
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
): Promise<PlatformCampaignRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      campaign: campaigns.name,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      landingPageViews: sumLandingPageViews,
      addToCart: sumAddToCart,
      addPayment: sumAddPayment,
      conversions: sumConversions,
      cpa,
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
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    landingPageViews: num(r.landingPageViews),
    addToCart: num(r.addToCart),
    addPayment: num(r.addPayment),
    conversions: num(r.conversions),
    cpa: numOrNull(r.cpa),
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
  const points: FunnelDailyPoint[] = rows.map((r) => ({
    date: r.date,
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    atcRate: numOrNull(r.atcRate),
    apRate: numOrNull(r.apRate),
    purchaseRate: numOrNull(r.purchaseRate),
    cvr: numOrNull(r.cvr),
  }));

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
