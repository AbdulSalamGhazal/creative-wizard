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
import { addDays, computeDelta, prevPeriod, type Delta } from "@/lib/period";
import { getActiveAccountId } from "@/lib/tenant";
import {
  mixRateDecomposition,
  type BridgeResult,
  type PeriodCreative,
} from "@/lib/decomposition";
import {
  benchmarkBand,
  expectedRoas,
  performanceIndex,
  type BenchmarkBand,
  type BenchmarkWeek,
} from "@/lib/campaign-benchmark";
import { campaignGap, type GapRow } from "@/lib/campaign-gap";

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
      campaign: performanceRecords.campaignName,
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
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(performanceRecords.campaignName)
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
      campaigns: sql<number>`COUNT(DISTINCT ${performanceRecords.campaignName})::int`,
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
      campaign: performanceRecords.campaignName,
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
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(performanceRecords.platform, performanceRecords.campaignName)
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
  platforms: Platform[];
  productNames: string[];
  creativeCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

/** All-time facts for one campaign. Null when the campaign has no records. */
export async function campaignMeta(name: string): Promise<CampaignMeta | null> {
  const acct = await getActiveAccountId();
  const [r] = await db
    .select({
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
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.campaignName, name),
      ),
    );

  if (!r || num(r.rows) === 0) return null;
  return {
    campaign: name,
    platforms: r.platforms ?? [],
    productNames: r.productNames ?? [],
    creativeCount: num(r.creativeCount),
    firstDate: r.firstDate,
    lastDate: r.lastDate,
  };
}

export interface CampaignTotals {
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  conversions: number;
  conversionValue: number;
  videoViews2s: number;
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
    eq(performanceRecords.campaignName, name),
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
    .where(cond);
  return {
    spend: num(r?.spend),
    impressions: num(r?.impressions),
    clicks: num(r?.clicks),
    landingPageViews: num(r?.landingPageViews),
    conversions: num(r?.conversions),
    conversionValue: num(r?.conversionValue),
    videoViews2s: num(r?.videoViews2s),
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
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(performanceRecords.date)
    .orderBy(asc(performanceRecords.date));
  return rows.map((r) => ({
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
  }));
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
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(performanceRecords.date)
    .orderBy(desc(performanceRecords.date));
  return rows.map((r) => ({
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
  }));
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
    .where(detailCond(name, range, acct, includeExcluded))
    .groupBy(performanceRecords.date, creatives.id, creatives.name)
    .orderBy(asc(performanceRecords.date));
  return rows.map((r) => ({
    date: r.date,
    creativeId: r.creativeId,
    creativeName: r.creativeName,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    conversionValue: num(r.conversionValue),
    cpm: numOrNull(r.cpm),
    cpc: numOrNull(r.cpc),
    cpa: numOrNull(r.cpa),
    ctr: numOrNull(r.ctr),
    voc: numOrNull(r.voc),
    cvr: numOrNull(r.cvr),
    roas: numOrNull(r.roas),
  }));
}

// =====================================================================
// Diagnosis: why a campaign wins or loses (spec §2). SQL only fetches
// grouped sums; all decomposition/index math lives in pure tested lib/*.
// =====================================================================

export type CompareMode = "prev" | "wow" | "mom";

/** The comparison window for a range + mode. `prev` = immediately-prior equal
 *  window; `wow`/`mom` = the same-length window shifted back 7 / 28 days. */
function compareRange(
  range: Range,
  compare: CompareMode,
): { from: string; to: string } | null {
  if (!range.from || !range.to) return null;
  if (compare === "wow") {
    return { from: addDays(range.from, -7), to: addDays(range.to, -7) };
  }
  if (compare === "mom") {
    return { from: addDays(range.from, -28), to: addDays(range.to, -28) };
  }
  return prevPeriod(range.from, range.to);
}

// ---- Within-audience expected baseline + Performance Index (§2.1) --------

export interface CampaignBenchmark {
  campaignRoas: number;
  expected: number;
  index: number;
  band: BenchmarkBand;
  /** False when the campaign is the only spender on its platform in-window
   *  (no peers) — the panel shows an insufficient-baseline state. */
  hasPeers: boolean;
}

export async function campaignBenchmark(
  campaign: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignBenchmark> {
  const acct = await getActiveAccountId();
  const empty: CampaignBenchmark = {
    campaignRoas: 0,
    expected: 0,
    index: 0,
    band: "on-par",
    hasPeers: false,
  };

  // One campaign_name = one platform; find it so peers stay same-platform.
  const [pr] = await db
    .select({ platform: performanceRecords.platform })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.campaignName, campaign),
      ),
    )
    .limit(1);
  const platform = pr?.platform as Platform | undefined;
  if (!platform) return empty;

  const conds: SQL[] = [
    eq(performanceRecords.accountId, acct),
    eq(performanceRecords.platform, platform),
  ];
  if (range.from && range.to) {
    conds.push(between(performanceRecords.date, range.from, range.to));
  }
  if (!includeExcluded) {
    conds.push(eq(performanceRecords.excludedFromAggregates, false));
  }

  // One row per ISO week: platform totals + this campaign's slice (FILTER).
  const rows = await db
    .select({
      totalSpend: sumSpend,
      totalRev: sumConversionValue,
      campSpend: sql<string>`SUM(${performanceRecords.spend}) FILTER (WHERE ${performanceRecords.campaignName} = ${campaign})`,
      campRev: sql<string>`SUM(${performanceRecords.conversionValue}) FILTER (WHERE ${performanceRecords.campaignName} = ${campaign})`,
    })
    .from(performanceRecords)
    .where(and(...conds))
    .groupBy(sql`date_trunc('week', ${performanceRecords.date})`);

  let campSpendTot = 0;
  let campRevTot = 0;
  const weeks: BenchmarkWeek[] = rows.map((r) => {
    const campSpend = num(r.campSpend);
    const campRev = num(r.campRev);
    campSpendTot += campSpend;
    campRevTot += campRev;
    return {
      campaignSpend: campSpend,
      peerSpend: Math.max(0, num(r.totalSpend) - campSpend),
      peerRev: Math.max(0, num(r.totalRev) - campRev),
    };
  });

  const campaignRoas = campSpendTot > 0 ? campRevTot / campSpendTot : 0;
  const expected = expectedRoas(weeks);
  return {
    campaignRoas,
    expected,
    index: performanceIndex(campaignRoas, expected),
    band: benchmarkBand(campaignRoas, expected),
    hasPeers: weeks.some((w) => w.peerSpend > 0),
  };
}

// ---- Mix vs Rate bridge (§2.2) ------------------------------------------

export interface CampaignBridge extends BridgeResult {
  /** False when the prior window has no spend (campaign too young) — the panel
   *  shows an insufficient-history state instead of a misleading bridge. */
  hasPrior: boolean;
  currentRange: { from: string; to: string } | null;
  priorRange: { from: string; to: string } | null;
}

async function periodCreatives(
  campaign: string,
  range: Range,
  acct: string,
  includeExcluded?: boolean,
): Promise<PeriodCreative[]> {
  const rows = await db
    .select({
      id: creatives.id,
      name: creatives.name,
      spend: sumSpend,
      rev: sumConversionValue,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(detailCond(campaign, range, acct, includeExcluded))
    .groupBy(creatives.id, creatives.name);
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      spend: num(r.spend),
      rev: num(r.rev),
    }))
    .filter((r) => r.spend > 0 || r.rev > 0);
}

export async function campaignBridge(
  campaign: string,
  range: Range,
  compare: CompareMode = "prev",
  includeExcluded?: boolean,
): Promise<CampaignBridge> {
  const acct = await getActiveAccountId();
  const prior = compareRange(range, compare);
  const [current, before] = await Promise.all([
    periodCreatives(campaign, range, acct, includeExcluded),
    prior
      ? periodCreatives(campaign, prior, acct, includeExcluded)
      : Promise.resolve([] as PeriodCreative[]),
  ]);
  // A = prior period, B = current period.
  const result = mixRateDecomposition(before, current);
  return {
    ...result,
    hasPrior: before.some((c) => c.spend > 0),
    currentRange:
      range.from && range.to ? { from: range.from, to: range.to } : null,
    priorRange: prior,
  };
}

// ---- Within-campaign winners/losers + money-left-on-the-table (§2.3) ----

export interface CampaignBreakdown {
  rows: GapRow[];
  campaignAvg: number;
  topQ: number;
  loserSpend: number;
  loserCount: number;
  floorMissed: number;
  ceilMissed: number;
}

export async function campaignBreakdown(
  campaign: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignBreakdown> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: creatives.id,
      name: creatives.name,
      spend: sumSpend,
      rev: sumConversionValue,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .where(detailCond(campaign, range, acct, includeExcluded))
    .groupBy(creatives.id, creatives.name);
  const gap = campaignGap(
    rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        spend: num(r.spend),
        rev: num(r.rev),
      }))
      .filter((r) => r.spend > 0),
  );
  return {
    rows: gap.rows,
    campaignAvg: gap.campaignAvg,
    topQ: gap.topQ,
    loserSpend: gap.loserSpend,
    loserCount: gap.loserCount,
    floorMissed: gap.floorMissed,
    ceilMissed: gap.ceilMissed,
  };
}

// ---- Retention curve (video only, §2.4) --------------------------------

export interface RetentionStage {
  stage: string;
  pct: number;
}

/** Aggregate video retention across the campaign's video creatives. Returns
 *  null when there's no video data (the panel is omitted, not rendered empty). */
export async function campaignRetention(
  campaign: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<RetentionStage[] | null> {
  const acct = await getActiveAccountId();
  const [r] = await db
    .select({
      v2: sumVideoViews2s,
      v25: sumVideoViews25,
      v50: sumVideoViews50,
      v75: sumVideoViews75,
      v100: sumVideoViews100,
    })
    .from(performanceRecords)
    .where(detailCond(campaign, range, acct, includeExcluded));
  const v2 = num(r?.v2);
  if (v2 <= 0) return null;
  const pct = (v: unknown) => (num(v) / v2) * 100;
  return [
    { stage: "2s view", pct: 100 },
    { stage: "25%", pct: pct(r?.v25) },
    { stage: "50%", pct: pct(r?.v50) },
    { stage: "75%", pct: pct(r?.v75) },
    { stage: "100%", pct: pct(r?.v100) },
  ];
}
