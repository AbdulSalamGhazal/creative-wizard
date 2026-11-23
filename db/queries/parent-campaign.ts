/**
 * CAMPAIGNS — the level above ad sets (2026-11). A campaign is a
 * `parent_campaigns` row: a name on one ad network; its ad sets are the
 * `campaigns` rows that point at it. (In code `campaign` still means the AD
 * SET — see "TWO LEVELS" in lib/campaign.ts.)
 *
 * REGISTRY-FIRST: everything here starts FROM the registry and LEFT JOINs the
 * records, so a campaign or an ad set with no data yet still has a row and a
 * page. Numbers are component sums through lib/metrics.ts over the RECORDS of
 * the ad sets — never a roll-up of per-ad-set ratios — and honour the
 * Excluded toggle like every aggregate.
 *
 * The list roll-up lives beside the ad-set list it mirrors
 * (`portfolioParentCampaigns`, db/queries/portfolio.ts); the range analytics,
 * creatives table and chart reuse db/queries/campaign.ts with a
 * `{ parentId }` scope.
 */

import { cache } from "react";
import { and, asc, between, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaignObjectiveEnum,
  campaigns,
  creatives,
  parentCampaigns,
  performanceRecords,
  platformEnum,
  products,
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
  voc,
} from "@/lib/metrics";
import { getActiveAccountId } from "@/lib/tenant";
import { campaignStatusFor, campaignStatusMap } from "@/db/queries/campaign-status";
import {
  deleteRulesTargetingCampaigns,
  deleteRulesTargetingParentCampaign,
} from "@/db/queries/exclusion-rules";
import type { CampaignStatus } from "@/lib/campaign-status";
import { numOrNull } from "@/db/queries/values";
import { fillDailyGaps } from "@/lib/time-series";
import { adSetLabel, type AdNetwork } from "@/lib/campaign";
import type {
  CampaignCreativeDailyPoint,
  CampaignDeletionSummary,
  Range,
} from "@/db/queries/campaign";

type Platform = (typeof platformEnum)[number];
type CampaignObjective = (typeof campaignObjectiveEnum)[number];

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** One campaign as the ⌘K palette lists it. */
export interface PaletteParentCampaign {
  name: string;
  network: AdNetwork;
}

/** The active brand's campaigns by name — the palette's "Campaigns" group. */
export async function listPaletteParentCampaigns(limit = 500): Promise<PaletteParentCampaign[]> {
  const acct = await getActiveAccountId();
  return db
    .select({ name: parentCampaigns.name, network: parentCampaigns.network })
    .from(parentCampaigns)
    .where(eq(parentCampaigns.accountId, acct))
    .orderBy(asc(parentCampaigns.name), asc(parentCampaigns.network))
    .limit(limit);
}

/** One campaign as a picker lists it: its id, its network, how many ad sets. */
export interface ParentCampaignOption {
  id: string;
  name: string;
  network: AdNetwork;
  adSets: number;
}

/**
 * The active brand's campaigns for a picker (the Exclusions rule form) — the
 * REGISTRY, so a campaign with no records yet can be chosen too. The ad-set
 * count is a LEFT JOIN on the registry, never a scan of the records.
 */
export async function listParentCampaignOptions(): Promise<ParentCampaignOption[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: parentCampaigns.id,
      name: parentCampaigns.name,
      network: parentCampaigns.network,
      adSets: sql<number>`COUNT(${campaigns.id})::int`,
    })
    .from(parentCampaigns)
    .leftJoin(
      campaigns,
      and(eq(campaigns.parentId, parentCampaigns.id), eq(campaigns.accountId, acct)),
    )
    .where(eq(parentCampaigns.accountId, acct))
    .groupBy(parentCampaigns.id, parentCampaigns.name, parentCampaigns.network)
    .orderBy(asc(parentCampaigns.name), asc(parentCampaigns.network));
  return rows.map((r) => ({ id: r.id, name: r.name, network: r.network, adSets: num(r.adSets) }));
}

/** One registered ad set of a campaign. */
export interface ParentCampaignAdSet {
  id: string;
  /** The full stored name — its page's address and the upload-matching key. */
  name: string;
  /** Its own name (the part after the campaign); the stored name as a fallback. */
  adsetName: string;
  platform: Platform;
  objective: CampaignObjective;
}

export interface ParentCampaignMeta {
  id: string;
  name: string;
  network: AdNetwork;
  createdAt: string;
  /** Every registered ad set, by ad-set name then platform. */
  adSets: ParentCampaignAdSet[];
  /** Active when ANY ad set is (the ad-set rule, rolled up — no new scan). */
  status: CampaignStatus;
  // ── All-time facts; empty before the first record ──
  hasRecords: boolean;
  productNames: string[];
  creativeCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * One campaign by its address — network + name — or null when it isn't
 * registered for the active brand. `cache()`-wrapped: the page and its
 * `generateMetadata` share one fetch.
 */
export const parentCampaignMeta = cache(
  async (network: string, name: string): Promise<ParentCampaignMeta | null> => {
    const acct = await getActiveAccountId();
    const [parent] = await db
      .select({
        id: parentCampaigns.id,
        name: parentCampaigns.name,
        network: parentCampaigns.network,
        createdAt: parentCampaigns.createdAt,
      })
      .from(parentCampaigns)
      .where(
        and(
          eq(parentCampaigns.accountId, acct),
          // The column's own vocabulary; an unknown network simply matches nothing.
          sql`${parentCampaigns.network} = ${network}`,
          eq(parentCampaigns.name, name),
        ),
      )
      .limit(1);
    if (!parent) return null;

    const [adSetRows, [facts], statusMap] = await Promise.all([
      db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          adsetName: campaigns.adsetName,
          platform: campaigns.platform,
          objective: campaigns.objective,
        })
        .from(campaigns)
        .where(and(eq(campaigns.accountId, acct), eq(campaigns.parentId, parent.id)))
        .orderBy(asc(campaigns.adsetName), asc(campaigns.platform)),
      db
        .select({
          productNames: sql<string[] | null>`array_agg(DISTINCT ${products.name})`,
          creativeCount: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
          firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
          lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
          rows: sql<number>`COUNT(*)::int`,
        })
        .from(performanceRecords)
        .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
        .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
        .innerJoin(products, eq(products.id, creatives.productId))
        .where(and(eq(performanceRecords.accountId, acct), eq(campaigns.parentId, parent.id))),
      campaignStatusMap(),
    ]);

    const adSets: ParentCampaignAdSet[] = adSetRows.map((a) => ({
      id: a.id,
      name: a.name,
      adsetName: a.adsetName ?? a.name,
      platform: a.platform,
      objective: a.objective,
    }));
    return {
      id: parent.id,
      name: parent.name,
      network: parent.network,
      createdAt: parent.createdAt.toISOString(),
      adSets,
      status: adSets.some((a) => campaignStatusFor(statusMap, a.id) === "active")
        ? "active"
        : "inactive",
      hasRecords: num(facts?.rows) > 0,
      productNames: facts?.productNames ?? [],
      creativeCount: num(facts?.creativeCount),
      firstDate: facts?.firstDate ?? null,
      lastDate: facts?.lastDate ?? null,
    };
  },
);

/** One ad set's row in its campaign's table — every figure null when it has no record in the range. */
export interface ParentAdSetRow extends ParentCampaignAdSet {
  status: CampaignStatus;
  creatives: number;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  orders: number | null;
  revenue: number | null;
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
  cpm: number | null;
  cvr: number | null;
  cpc: number | null;
  voc: number | null;
  lpv: number | null;
  lastDate: string | null;
}

/**
 * A campaign's ad sets, side by side, over a range. EVERY registered ad set is
 * a row: the range and the Excluded filter sit in the JOIN, not the WHERE, so
 * an ad set with nothing in the range keeps its row (all "—") instead of
 * vanishing — a just-added ad set must be visible here.
 */
export async function parentCampaignAdSets(
  parentId: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<ParentAdSetRow[]> {
  const acct = await getActiveAccountId();
  const [rows, statusMap] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        adsetName: campaigns.adsetName,
        platform: campaigns.platform,
        objective: campaigns.objective,
        creatives: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
        spend: sumSpend,
        impressions: sumImpressions,
        clicks: sumClicks,
        orders: sumConversions,
        revenue: sumConversionValue,
        lpv: sumLandingPageViews,
        cpa,
        roas,
        ctr,
        cpm,
        cvr,
        cpc,
        voc,
        lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
      })
      .from(campaigns)
      .leftJoin(
        performanceRecords,
        and(
          eq(performanceRecords.campaignId, campaigns.id),
          eq(performanceRecords.accountId, acct),
          range.from && range.to
            ? between(performanceRecords.date, range.from, range.to)
            : undefined,
          includeExcluded ? undefined : eq(performanceRecords.excludedFromAggregates, false),
        ),
      )
      .where(and(eq(campaigns.accountId, acct), eq(campaigns.parentId, parentId)))
      .groupBy(campaigns.id),
    campaignStatusMap(),
  ]);
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      adsetName: r.adsetName ?? r.name,
      platform: r.platform,
      objective: r.objective,
      status: campaignStatusFor(statusMap, r.id),
      creatives: num(r.creatives),
      spend: numOrNull(r.spend),
      impressions: numOrNull(r.impressions),
      clicks: numOrNull(r.clicks),
      orders: numOrNull(r.orders),
      revenue: numOrNull(r.revenue),
      lpv: numOrNull(r.lpv),
      cpa: numOrNull(r.cpa),
      roas: numOrNull(r.roas),
      ctr: numOrNull(r.ctr),
      cpm: numOrNull(r.cpm),
      cvr: numOrNull(r.cvr),
      cpc: numOrNull(r.cpc),
      voc: numOrNull(r.voc),
      lastDate: r.lastDate,
    }))
    .sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || a.adsetName.localeCompare(b.adsetName));
}

/**
 * The chart's series: one line per AD SET per day. Returned in the
 * per-creative chart's own point shape (`creativeId` / `creativeName` are the
 * series key and label there) so the campaign page draws it with the SAME
 * chart — the series is the ad set, labelled with its platform when the
 * campaign runs it on more than one.
 */
export async function parentCampaignDailyByAdSet(
  parentId: string,
  range: Range,
  includeExcluded?: boolean,
): Promise<CampaignCreativeDailyPoint[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      date: performanceRecords.date,
      adSetId: campaigns.id,
      storedName: campaigns.name,
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
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(campaigns.parentId, parentId),
        range.from && range.to ? between(performanceRecords.date, range.from, range.to) : undefined,
        includeExcluded ? undefined : eq(performanceRecords.excludedFromAggregates, false),
      ),
    )
    .groupBy(performanceRecords.date, campaigns.id)
    .orderBy(asc(performanceRecords.date));
  return fillDailyGaps(
    rows.map((r) => ({
      date: r.date,
      creativeId: r.adSetId,
      // The stored name minus the campaign prefix keeps the platform tag
      // (` (IG)` / ` (FB)`), which is what tells two Meta lines apart.
      creativeName: adSetLabel(r.storedName),
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


/** What deleting a campaign removes: its ad sets, and every record of theirs. */
export interface ParentCampaignDeletionSummary extends CampaignDeletionSummary {
  adSets: number;
}

/**
 * Everything hard-deleted alongside a campaign — the confirm dialog's facts.
 * The CREATIVES that ran in it are kept (only their records under these ad
 * sets go), so their count is surfaced to make that explicit.
 */
export async function parentCampaignDeletionSummary(
  parentId: string,
): Promise<ParentCampaignDeletionSummary> {
  const acct = await getActiveAccountId();
  const [byPlatform, [agg], [sets]] = await Promise.all([
    db
      .select({
        platform: performanceRecords.platform,
        records: sql<number>`COUNT(*)::int`,
        firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
        lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .where(and(eq(performanceRecords.accountId, acct), eq(campaigns.parentId, parentId)))
      .groupBy(performanceRecords.platform),
    db
      .select({
        creatives: sql<number>`COUNT(DISTINCT ${performanceRecords.creativeId})::int`,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .where(and(eq(performanceRecords.accountId, acct), eq(campaigns.parentId, parentId))),
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(campaigns)
      .where(and(eq(campaigns.accountId, acct), eq(campaigns.parentId, parentId))),
  ]);

  let records = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  const platforms = byPlatform.map((r) => {
    records += r.records;
    if (r.firstDate && (!firstDate || r.firstDate < firstDate)) firstDate = r.firstDate;
    if (r.lastDate && (!lastDate || r.lastDate > lastDate)) lastDate = r.lastDate;
    return { platform: r.platform as Platform, records: r.records };
  });
  platforms.sort((a, b) => b.records - a.records);
  return {
    adSets: num(sets?.n),
    records,
    platforms,
    creatives: num(agg?.creatives),
    firstDate,
    lastDate,
  };
}

/** db or a transaction handle — the delete below runs on the caller's `tx`. */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface DeletedParentCampaign {
  adSetIds: string[];
  records: number;
  /** The creatives that lost records, and the months whose actuals moved. */
  creativeIds: string[];
  months: string[];
}

/**
 * Hard-delete a campaign with everything under it — the body of
 * `deleteParentCampaign`, which owns the transaction and passes its `tx`
 * (production's pool is ONE connection: nothing here may reach the global
 * `db`). In order, because no FK cascades: the RECORDS of every ad set (one
 * statement), the exclusion rules targeting those ad sets, the ad sets, the
 * rule targeting the campaign as a whole, the campaign. What the audit links
 * to is read with two `SELECT DISTINCT` BEFORE
 * the delete — never a `RETURNING` of tens of thousands of rows.
 *
 * A sanctioned exit path for `performance_records` (CLAUDE.md, Database
 * rules #4): the CREATIVES are kept — only their records here go.
 */
export async function deleteParentCampaignRows(
  tx: Exec,
  acct: string,
  parentId: string,
): Promise<DeletedParentCampaign> {
  const children = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.accountId, acct), eq(campaigns.parentId, parentId)));
  const adSetIds = children.map((c) => c.id);

  let records = 0;
  let creativeIds: string[] = [];
  let months: string[] = [];
  if (adSetIds.length > 0) {
    const scope = and(
      eq(performanceRecords.accountId, acct),
      inArray(performanceRecords.campaignId, adSetIds),
    );
    const [n] = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(performanceRecords)
      .where(scope);
    records = num(n?.n);
    if (records > 0) {
      const touchedCreatives = await tx
        .selectDistinct({ id: performanceRecords.creativeId })
        .from(performanceRecords)
        .where(scope);
      const touchedMonths = await tx
        .selectDistinct({ month: sql<string>`to_char(${performanceRecords.date}, 'YYYY-MM')` })
        .from(performanceRecords)
        .where(scope);
      creativeIds = touchedCreatives.map((r) => r.id);
      months = touchedMonths.map((r) => r.month);
      await tx.delete(performanceRecords).where(scope);
    }
    await deleteRulesTargetingCampaigns(tx, acct, adSetIds);
    await tx
      .delete(campaigns)
      .where(and(eq(campaigns.accountId, acct), eq(campaigns.parentId, parentId)));
  }
  // A WHOLE-CAMPAIGN exclusion rule points at the campaign itself. Its
  // stamped records went with the ad sets above, so nothing references the
  // rule any more; it must go before the row it points at (no cascade).
  await deleteRulesTargetingParentCampaign(tx, acct, parentId);
  await tx
    .delete(parentCampaigns)
    .where(and(eq(parentCampaigns.accountId, acct), eq(parentCampaigns.id, parentId)));
  return { adSetIds, records, creativeIds, months };
}
