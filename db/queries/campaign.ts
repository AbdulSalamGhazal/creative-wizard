import { cache } from "react";
import {
  and,
  asc,
  between,
  desc,
  eq,
  gt,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creatives,
  creativeTags,
  creativeTypeEnum,
  performanceRecords,
  platformEnum,
  products,
} from "@/db/schema";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import type { CreativeStatus } from "@/lib/creative-status";
import {
  completeRate,
  cpa,
  cpc,
  cpm,
  ctr,
  cvr,
  hookRate,
  holdRate,
  roas,
  sumAddToCart,
  sumAddPayment,
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
import { computeDelta, prevPeriod, type Delta } from "@/lib/period";
import { fillDailyGaps } from "@/lib/time-series";
import { getActiveAccountId } from "@/lib/tenant";

type Platform = (typeof platformEnum)[number];
type CreativeType = (typeof creativeTypeEnum)[number];

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export interface Range {
  from?: string;
  to?: string;
}

// =====================================================================
// Index: one row per campaign_name
// =====================================================================

export interface CampaignFilters extends Range {
  platforms?: Platform[];
  productIds?: string[];
  types?: CreativeType[];
  tags?: string[];
  includeExcluded?: boolean;
}

export interface CampaignListRow {
  campaign: string;
  platforms: Platform[];
  creatives: number;
  spend: number;
  impressions: number;
  conversions: number;
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  firstDate: string | null;
  lastDate: string | null;
}

function listConds(f: CampaignFilters, acct: string): SQL[] {
  const c: SQL[] = [eq(performanceRecords.accountId, acct)];
  if (f.from && f.to) c.push(between(performanceRecords.date, f.from, f.to));
  if (!f.includeExcluded) {
    c.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    c.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.productIds && f.productIds.length > 0) {
    c.push(inArray(creatives.productId, f.productIds));
  }
  if (f.types && f.types.length > 0) {
    c.push(inArray(creatives.type, f.types));
  }
  if (f.tags && f.tags.length > 0) {
    c.push(
      sql`EXISTS (SELECT 1 FROM ${creativeTags} ct
                  WHERE ct.creative_id = ${creatives.id}
                    AND ct.tag IN ${f.tags})`,
    );
  }
  return c;
}

export async function listCampaigns(
  f: CampaignFilters,
): Promise<CampaignListRow[]> {
  const conds = listConds(f, await getActiveAccountId());
  const rows = await db
    .select({
      campaign: campaigns.name,
      platforms: sql<Platform[]>`array_agg(DISTINCT ${performanceRecords.platform})`,
      creatives: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
      spend: sumSpend,
      impressions: sumImpressions,
      conversions: sumConversions,
      ctr,
      cvr,
      cpa,
      roas,
      firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(campaigns.id)
    .orderBy(desc(sumSpend));

  return rows.map((r) => ({
    campaign: r.campaign,
    platforms: r.platforms ?? [],
    creatives: num(r.creatives),
    spend: num(r.spend),
    impressions: num(r.impressions),
    conversions: num(r.conversions),
    ctr: numOrNull(r.ctr),
    cvr: numOrNull(r.cvr),
    cpa: numOrNull(r.cpa),
    roas: numOrNull(r.roas),
    firstDate: r.firstDate,
    lastDate: r.lastDate,
  }));
}

// =====================================================================
// Portfolio: blended totals across all campaigns (for the index header)
// =====================================================================

export interface CampaignPortfolio {
  campaigns: number;
  platforms: number;
  creatives: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
}

export async function campaignPortfolio(
  f: CampaignFilters,
): Promise<CampaignPortfolio> {
  const conds = listConds(f, await getActiveAccountId());
  const [r] = await db
    .select({
      campaigns: sql<number>`COUNT(DISTINCT ${performanceRecords.campaignId})::int`,
      platforms: sql<number>`COUNT(DISTINCT ${performanceRecords.platform})::int`,
      creatives: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      ctr,
      cvr,
      cpa,
      roas,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(conds.length > 0 ? and(...conds) : undefined);
  return {
    campaigns: num(r?.campaigns),
    platforms: num(r?.platforms),
    creatives: num(r?.creatives),
    spend: num(r?.spend),
    impressions: num(r?.impressions),
    clicks: num(r?.clicks),
    conversions: num(r?.conversions),
    conversionValue: num(r?.conversionValue),
    ctr: numOrNull(r?.ctr),
    cvr: numOrNull(r?.cvr),
    cpa: numOrNull(r?.cpa),
    roas: numOrNull(r?.roas),
  };
}

// =====================================================================
// Per (platform, campaign) grain — powers the comparison graphs + winners
// =====================================================================

export interface CampaignPlatformGrainRow {
  platform: Platform;
  campaign: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  conversions: number;
  conversionValue: number;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
}

export async function campaignByPlatform(
  f: CampaignFilters,
): Promise<CampaignPlatformGrainRow[]> {
  const conds = listConds(f, await getActiveAccountId());
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      campaign: campaigns.name,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      landingPageViews: sumLandingPageViews,
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
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(performanceRecords.platform, campaigns.id)
    .having(gt(sumSpend, 0))
    .orderBy(desc(sumSpend));
  return rows.map((r) => ({
    platform: r.platform as Platform,
    campaign: r.campaign,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    landingPageViews: num(r.landingPageViews),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    cvr: numOrNull(r.cvr),
    cpa: numOrNull(r.cpa),
    roas: numOrNull(r.roas),
  }));
}

// =====================================================================
// Detail: meta (all-time) + analytics (range) for one campaign
// =====================================================================

export interface CampaignMeta {
  campaign: string;
  objective: string;
  platforms: Platform[];
  productNames: string[];
  creativeCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface CampaignRegistry {
  id: string;
  platform: Platform;
  objective: string;
}

/**
 * The registry row (id + platform + objective) behind a stored campaign name,
 * account-scoped. Powers the edit dialog (campaignMeta exposes the name +
 * objective for display, but not the id/platform the edit form needs to rebuild
 * the name). Null when the name isn't registered for the active account.
 */
export async function campaignRegistry(
  name: string,
): Promise<CampaignRegistry | null> {
  const acct = await getActiveAccountId();
  const [r] = await db
    .select({
      id: campaigns.id,
      platform: campaigns.platform,
      objective: campaigns.objective,
    })
    .from(campaigns)
    .where(and(eq(campaigns.accountId, acct), eq(campaigns.name, name)))
    .limit(1);
  return r ? { id: r.id, platform: r.platform as Platform, objective: r.objective } : null;
}

/**
 * All-time facts for one campaign. Null when the campaign has no records.
 *
 * `cache()`-wrapped so the detail page and its `generateMetadata` (which needs
 * the name for the tab title) share ONE fetch per request instead of querying
 * twice. Mirrors the dedupe pattern in lib/tenant.ts / lib/auth.ts.
 */
export const campaignMeta = cache(async (
  name: string,
): Promise<CampaignMeta | null> => {
  const acct = await getActiveAccountId();
  const [r] = await db
    .select({
      // One campaign = one objective, so MIN just returns that single value
      // without needing a GROUP BY alongside the aggregates.
      objective: sql<string>`MIN(${campaigns.objective})`,
      platforms: sql<Platform[]>`array_agg(DISTINCT ${performanceRecords.platform})`,
      productNames: sql<string[]>`array_agg(DISTINCT ${products.name})`,
      creativeCount: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
      firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
      rows: sql<number>`COUNT(*)::int`,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(campaigns.name, name),
      ),
    );

  if (!r || num(r.rows) === 0) return null;
  return {
    campaign: name,
    objective: r.objective,
    platforms: r.platforms ?? [],
    productNames: r.productNames ?? [],
    creativeCount: num(r.creativeCount),
    firstDate: r.firstDate,
    lastDate: r.lastDate,
  };
});

export interface CampaignDeletionSummary {
  /** Total performance_records that would be hard-deleted with the campaign. */
  records: number;
  /** Per-platform record counts, busiest first (usually one — a campaign is single-platform). */
  platforms: { platform: Platform; records: number }[];
  /** Distinct creatives that ran in this campaign (they are NOT deleted). */
  creatives: number;
  /** Earliest / latest record date (YYYY-MM-DD), or null when no records. */
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Everything hard-deleted alongside a campaign. `performance_records` is FK'd to
 * exactly one campaign with NO `ON DELETE CASCADE`, so the delete action removes
 * these rows explicitly (inside a transaction) before dropping the campaign row.
 * Unlike deleting a creative, the CREATIVES that ran in this campaign are kept —
 * only their records tied to THIS campaign go, so the `creatives` count is
 * surfaced to make that consequence explicit in the confirm dialog.
 * Account-scoped for defence in depth (campaign_id is already account-unique).
 */
export async function campaignDeletionSummary(
  campaignId: string,
): Promise<CampaignDeletionSummary> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      records: sql<number>`COUNT(*)::int`,
      firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.campaignId, campaignId),
      ),
    )
    .groupBy(performanceRecords.platform);

  let records = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  const platforms = rows.map((r) => {
    records += r.records;
    if (r.firstDate && (!firstDate || r.firstDate < firstDate)) firstDate = r.firstDate;
    if (r.lastDate && (!lastDate || r.lastDate > lastDate)) lastDate = r.lastDate;
    return { platform: r.platform as Platform, records: r.records };
  });
  platforms.sort((a, b) => b.records - a.records);

  const [agg] = await db
    .select({
      creatives: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.campaignId, campaignId),
      ),
    );

  return { records, platforms, creatives: num(agg?.creatives), firstDate, lastDate };
}

export interface CampaignTotals {
  // Additive metrics are null (not 0) on an EMPTY window — SUM over no rows is
  // NULL, so an empty range renders "—" rather than a misleading "$0.00" / "0"
  // (a real zero, i.e. rows that sum to 0, still renders as 0).
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  landingPageViews: number | null;
  conversions: number | null;
  conversionValue: number | null;
  videoViews2s: number | null;
  cpm: number | null;
  cpc: number | null;
  cpa: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
  roas: number | null;
  hookRate: number | null;
  holdRate: number | null;
  completeRate: number | null;
}

export type CampaignDeltaKey =
  | "spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "conversionValue"
  | "cpm"
  | "cpc"
  | "cpa"
  | "ctr"
  | "voc"
  | "cvr"
  | "roas";

export interface CampaignAnalytics {
  totals: CampaignTotals;
  /** Period-over-period deltas vs the immediately-prior equal window. Null
   *  when no bounded range is set (all-time view has nothing to compare to). */
  deltas: Record<CampaignDeltaKey, Delta> | null;
}

function detailCond(
  name: string,
  range: Range,
  acct: string,
  includeExcluded?: boolean,
): SQL {
  const c: SQL[] = [
    eq(performanceRecords.accountId, acct),
    eq(campaigns.name, name),
  ];
  if (range.from && range.to) {
    c.push(between(performanceRecords.date, range.from, range.to));
  }
  if (!includeExcluded) {
    c.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  return and(...c)!;
}

async function totalsFor(cond: SQL): Promise<CampaignTotals> {
  const [r] = await db
    .select({
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      landingPageViews: sumLandingPageViews,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      videoViews2s: sumVideoViews2s,
      cpm,
      cpc,
      cpa,
      ctr,
      voc,
      cvr,
      roas,
      hookRate,
      holdRate,
      completeRate,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(cond);
  return {
    // numOrNull so an empty window (SUM → NULL) yields null → "—" in the UI,
    // while a real zero stays 0.
    spend: numOrNull(r?.spend),
    impressions: numOrNull(r?.impressions),
    clicks: numOrNull(r?.clicks),
    landingPageViews: numOrNull(r?.landingPageViews),
    conversions: numOrNull(r?.conversions),
    conversionValue: numOrNull(r?.conversionValue),
    videoViews2s: numOrNull(r?.videoViews2s),
    cpm: numOrNull(r?.cpm),
    cpc: numOrNull(r?.cpc),
    cpa: numOrNull(r?.cpa),
    ctr: numOrNull(r?.ctr),
    voc: numOrNull(r?.voc),
    cvr: numOrNull(r?.cvr),
    roas: numOrNull(r?.roas),
    hookRate: numOrNull(r?.hookRate),
    holdRate: numOrNull(r?.holdRate),
    completeRate: numOrNull(r?.completeRate),
  };
}

export async function campaignAnalytics(
  name: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignAnalytics> {
  const acct = await getActiveAccountId();
  const bounded = Boolean(range.from && range.to);
  if (!bounded) {
    const totals = await totalsFor(detailCond(name, range, acct, includeExcluded));
    return { totals, deltas: null };
  }
  const prev = prevPeriod(range.from!, range.to!);
  const [totals, prior] = await Promise.all([
    totalsFor(detailCond(name, range, acct, includeExcluded)),
    totalsFor(
      detailCond(name, { from: prev.from, to: prev.to }, acct, includeExcluded),
    ),
  ]);
  const d = (k: CampaignDeltaKey): Delta =>
    computeDelta(totals[k], prior[k]);
  return {
    totals,
    deltas: {
      spend: d("spend"),
      impressions: d("impressions"),
      clicks: d("clicks"),
      conversions: d("conversions"),
      conversionValue: d("conversionValue"),
      cpm: d("cpm"),
      cpc: d("cpc"),
      cpa: d("cpa"),
      ctr: d("ctr"),
      voc: d("voc"),
      cvr: d("cvr"),
      roas: d("roas"),
    },
  };
}

// =====================================================================
// Detail: daily series
// =====================================================================

export interface CampaignDailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  cpm: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
  roas: number | null;
}

export async function campaignDaily(
  name: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignDailyPoint[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      date: performanceRecords.date,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      cpm,
      ctr,
      voc,
      cvr,
      roas,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(performanceRecords.date)
    .orderBy(asc(performanceRecords.date));
  // Insert interior no-data days (0 for sums, null for ratios) so the chart
  // shows a real zero dip instead of skipping the day.
  return fillDailyGaps(
    rows.map((r) => ({
      date: r.date,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      conversions: num(r.conversions),
      conversionValue: num(r.conversionValue),
      cpm: numOrNull(r.cpm),
      ctr: numOrNull(r.ctr),
      voc: numOrNull(r.voc),
      cvr: numOrNull(r.cvr),
      roas: numOrNull(r.roas),
    })),
    {
      dateKey: "date",
      additiveKeys: ["spend", "impressions", "clicks", "conversions", "conversionValue"],
      ratioKeys: ["cpm", "ctr", "voc", "cvr", "roas"],
    },
  );
}

// =====================================================================
// Detail: per-platform split
// =====================================================================

export interface CampaignPlatformRow {
  platform: Platform;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
}

export async function campaignPlatforms(
  name: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignPlatformRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      ctr,
      voc,
      cvr,
      cpa,
      roas,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(performanceRecords.platform)
    .orderBy(desc(sumSpend));
  return rows.map((r) => ({
    platform: r.platform as Platform,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    cvr: numOrNull(r.cvr),
    cpa: numOrNull(r.cpa),
    roas: numOrNull(r.roas),
  }));
}

// =====================================================================
// Detail: creatives running in this campaign
// =====================================================================

export interface CampaignCreativeRow {
  creativeId: string;
  name: string;
  type: CreativeType;
  status: CreativeStatus;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  lastDate: string | null;
}

export async function campaignCreatives(
  name: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignCreativeRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      type: creatives.type,
      thumbnailUrl: creatives.thumbnailUrl,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      ctr,
      cvr,
      cpa,
      roas,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(
      creatives.id,
      creatives.name,
      creatives.type,
      creatives.thumbnailUrl,
    )
    .orderBy(desc(sumSpend));

  // Attach the dynamic general status for each creative in this campaign.
  const sMap = await creativeStatusMap(rows.map((r) => r.creativeId));

  return rows.map((r) => ({
    creativeId: r.creativeId,
    name: r.name,
    type: r.type as CreativeType,
    status: statusFor(sMap, r.creativeId).general,
    thumbnailUrl: r.thumbnailUrl,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    ctr: numOrNull(r.ctr),
    cvr: numOrNull(r.cvr),
    cpa: numOrNull(r.cpa),
    roas: numOrNull(r.roas),
    lastDate: r.lastDate,
  }));
}

// =====================================================================
// Detail: day-level records
// =====================================================================

/** Every uploaded metric field, plus the row's identity. `null` = the platform
 *  didn't report that field for this row. */
export interface CampaignRecordRow {
  id: number;
  date: string;
  creativeName: string;
  platform: Platform;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  landingPageViews: number | null;
  addToCart: number | null;
  addPayment: number | null;
  videoViews2s: number | null;
  videoViews25: number | null;
  videoViews50: number | null;
  videoViews75: number | null;
  videoViews100: number | null;
  excludedFromAggregates: boolean;
}

export async function campaignRecords(
  name: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignRecordRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: performanceRecords.id,
      date: performanceRecords.date,
      creativeName: creatives.name,
      platform: performanceRecords.platform,
      spend: performanceRecords.spend,
      impressions: performanceRecords.impressions,
      clicks: performanceRecords.clicks,
      conversions: performanceRecords.conversions,
      conversionValue: performanceRecords.conversionValue,
      landingPageViews: performanceRecords.landingPageViews,
      addToCart: performanceRecords.addToCart,
      addPayment: performanceRecords.addPayment,
      videoViews2s: performanceRecords.videoViews2s,
      videoViews25: performanceRecords.videoViews25,
      videoViews50: performanceRecords.videoViews50,
      videoViews75: performanceRecords.videoViews75,
      videoViews100: performanceRecords.videoViews100,
      excludedFromAggregates: performanceRecords.excludedFromAggregates,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(detailCond(name, range, acct, includeExcluded))
    .orderBy(desc(performanceRecords.date), desc(performanceRecords.spend))
    .limit(2000);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    creativeName: r.creativeName,
    platform: r.platform as Platform,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: numOrNull(r.conversions),
    conversionValue: numOrNull(r.conversionValue),
    landingPageViews: numOrNull(r.landingPageViews),
    addToCart: numOrNull(r.addToCart),
    addPayment: numOrNull(r.addPayment),
    videoViews2s: numOrNull(r.videoViews2s),
    videoViews25: numOrNull(r.videoViews25),
    videoViews50: numOrNull(r.videoViews50),
    videoViews75: numOrNull(r.videoViews75),
    videoViews100: numOrNull(r.videoViews100),
    excludedFromAggregates: r.excludedFromAggregates,
  }));
}

// =====================================================================
// Detail: day-level rollup (all creatives merged) — for the records table's
// "group by day" toggle. One row per date, every metric field SUMmed.
// =====================================================================

export interface CampaignDayRow {
  date: string;
  records: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
  addToCart: number;
  addPayment: number;
  videoViews2s: number;
  videoViews25: number;
  videoViews50: number;
  videoViews75: number;
  videoViews100: number;
}

export async function campaignRecordsByDay(
  name: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignDayRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      date: performanceRecords.date,
      records: sql<number>`COUNT(*)::int`,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      landingPageViews: sumLandingPageViews,
      addToCart: sumAddToCart,
      addPayment: sumAddPayment,
      videoViews2s: sumVideoViews2s,
      videoViews25: sumVideoViews25,
      videoViews50: sumVideoViews50,
      videoViews75: sumVideoViews75,
      videoViews100: sumVideoViews100,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(performanceRecords.date)
    .orderBy(desc(performanceRecords.date));
  // Fill interior no-data days with all-zero rows (everything here is a SUM /
  // COUNT), then restore this function's newest-first ordering.
  return fillDailyGaps(
    rows.map((r) => ({
      date: r.date,
      records: num(r.records),
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      conversions: num(r.conversions),
      conversionValue: num(r.conversionValue),
      landingPageViews: num(r.landingPageViews),
      addToCart: num(r.addToCart),
      addPayment: num(r.addPayment),
      videoViews2s: num(r.videoViews2s),
      videoViews25: num(r.videoViews25),
      videoViews50: num(r.videoViews50),
      videoViews75: num(r.videoViews75),
      videoViews100: num(r.videoViews100),
    })),
    {
      dateKey: "date",
      additiveKeys: [
        "records",
        "spend",
        "impressions",
        "clicks",
        "conversions",
        "conversionValue",
        "landingPageViews",
        "addToCart",
        "addPayment",
        "videoViews2s",
        "videoViews25",
        "videoViews50",
        "videoViews75",
        "videoViews100",
      ],
    },
  ).reverse();
}

// =====================================================================
// Detail: per-creative daily series — one line per creative in the chart.
// =====================================================================

export interface CampaignCreativeDailyPoint {
  date: string;
  creativeId: string;
  creativeName: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  conversions: number;
  conversionValue: number;
  cpm: number | null;
  cpc: number | null;
  cpa: number | null;
  ctr: number | null;
  voc: number | null;
  cvr: number | null;
  roas: number | null;
}

export async function campaignDailyByCreative(
  name: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignCreativeDailyPoint[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      date: performanceRecords.date,
      creativeId: creatives.id,
      creativeName: creatives.name,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      landingPageViews: sumLandingPageViews,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      cpm,
      cpc,
      cpa,
      ctr,
      voc,
      cvr,
      roas,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(performanceRecords.date, creatives.id, creatives.name)
    .orderBy(asc(performanceRecords.date));
  // Fill interior no-data days PER CREATIVE (each line over its own
  // first→last span): 0 for sums, null for ratios so the line breaks.
  return fillDailyGaps(
    rows.map((r) => ({
      date: r.date,
      creativeId: r.creativeId,
      creativeName: r.creativeName,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      landingPageViews: num(r.landingPageViews),
      conversions: num(r.conversions),
      conversionValue: num(r.conversionValue),
      cpm: numOrNull(r.cpm),
      cpc: numOrNull(r.cpc),
      cpa: numOrNull(r.cpa),
      ctr: numOrNull(r.ctr),
      voc: numOrNull(r.voc),
      cvr: numOrNull(r.cvr),
      roas: numOrNull(r.roas),
    })),
    {
      dateKey: "date",
      groupKey: "creativeId",
      additiveKeys: [
        "spend",
        "impressions",
        "clicks",
        "landingPageViews",
        "conversions",
        "conversionValue",
      ],
      ratioKeys: ["cpm", "cpc", "cpa", "ctr", "voc", "cvr", "roas"],
    },
  );
}
