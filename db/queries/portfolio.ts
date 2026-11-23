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
import {
  campaignObjectiveEnum,
  campaigns,
  parentCampaigns,
  performanceRecords,
  platformEnum,
} from "@/db/schema";
import { networkPlatforms, type AdNetwork } from "@/lib/campaign";
import {
  aov as aovSql,
  cpm as cpmSql,
  ctr as ctrSql,
  cvr as cvrSql,
  cpa as cpaSql,
  cpc as cpcSql,
  roas as roasSql,
  voc as vocSql,
  sumAddPayment,
  sumAddToCart,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
} from "@/lib/metrics";
import { getActiveAccountId } from "@/lib/tenant";
import { campaignStatusFor, campaignStatusMap } from "@/db/queries/campaign-status";
import type { CampaignStatus } from "@/lib/campaign-status";
import { numOrNull } from "@/db/queries/values";

type Platform = (typeof platformEnum)[number];
type CampaignObjective = (typeof campaignObjectiveEnum)[number];

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export interface PortfolioFilters {
  /** Required — the page defaults to the last 30 days when no range is set. */
  from: string;
  to: string;
  platforms?: Platform[];
  /** Campaign objective(s) — registry attribute, multi-select. */
  objectives?: CampaignObjective[];
  /** Dynamic status (active/inactive) — derived, filtered in JS post-query. */
  statuses?: CampaignStatus[];
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
  if (f.objectives && f.objectives.length > 0) {
    // campaigns is joined in portfolioCampaigns, so this filters on the
    // registry's objective for each row's campaign.
    c.push(inArray(campaigns.objective, f.objectives));
  }
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`;
    // Match on the campaign name OR on a creative name — and when a creative
    // matches, keep the WHOLE campaign (every campaign that runs that creative),
    // not just that creative's rows. So the second arm is a campaign-level IN.
    c.push(
      or(
        ilike(campaigns.name, like),
        sql`${performanceRecords.campaignId} IN (
          SELECT DISTINCT pr2.campaign_id
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
  campaignId: string;
  campaign: string;
  objective: CampaignObjective;
  /** Dynamic liveness (spend-derived), computed over all data — not the range. */
  status: CampaignStatus;
  platforms: Platform[];
  creatives: number;
  spend: number;
  impressions: number;
  clicks: number;
  /** NULL when the platform never reports LP views (google) — NULL ≠ 0. */
  lpv: number | null;
  orders: number;
  revenue: number;
  cpa: number | null;
  roas: number | null;
  aov: number | null;
  ctr: number | null;
  cpm: number | null;
  cvr: number | null;
  lastDate: string | null;
  // ── Offered, hidden by default (2026-11): free at this grain ──
  /** Views over clicks — google's rows sit out of both sides (lib/metrics). */
  voc: number | null;
  cpc: number | null;
  /** NULL when the campaign's platform never reports the step (NULL ≠ 0). */
  addToCart: number | null;
  addPayment: number | null;
  /** The first day in the range with a record (MIN(date)). */
  firstDate: string | null;
  /** When the campaign was registered — a PK-join column. */
  createdAt: string;
}

export async function portfolioCampaigns(
  f: PortfolioFilters,
  range?: { from: string; to: string },
): Promise<PortfolioCampaignRow[]> {
  const acct = await getActiveAccountId();
  const r = range ?? { from: f.from, to: f.to };
  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaign: campaigns.name,
      objective: campaigns.objective,
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
      aov: aovSql,
      ctr: ctrSql,
      cpm: cpmSql,
      cvr: cvrSql,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
      voc: vocSql,
      cpc: cpcSql,
      addToCart: sumAddToCart,
      addPayment: sumAddPayment,
      firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
      createdAt: campaigns.createdAt,
    })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(and(...baseConds(f, r, acct)))
    .groupBy(campaigns.id)
    .orderBy(desc(sumSpend));
  const base = rows.map((row) => ({
    campaignId: row.campaignId,
    campaign: row.campaign,
    objective: row.objective,
    platforms: row.platforms ?? [],
    creatives: num(row.creatives),
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    lpv: numOrNull(row.lpv),
    orders: num(row.orders),
    revenue: num(row.revenue),
    cpa: numOrNull(row.cpa),
    roas: numOrNull(row.roas),
    aov: numOrNull(row.aov),
    ctr: numOrNull(row.ctr),
    cpm: numOrNull(row.cpm),
    cvr: numOrNull(row.cvr),
    lastDate: row.lastDate,
    voc: numOrNull(row.voc),
    cpc: numOrNull(row.cpc),
    addToCart: numOrNull(row.addToCart),
    addPayment: numOrNull(row.addPayment),
    firstDate: row.firstDate,
    createdAt: row.createdAt.toISOString(),
  }));

  // Attach dynamic status (computed over ALL data — current liveness, not the
  // range) and apply the status filter here: a derived value can't be a SQL
  // WHERE, so it's filtered in the query layer (like Library/Summary status).
  const statusMap = await campaignStatusMap();
  const rowsWithStatus: PortfolioCampaignRow[] = base.map((b) => ({
    ...b,
    status: campaignStatusFor(statusMap, b.campaignId),
  }));
  if (f.statuses && f.statuses.length > 0) {
    const want = new Set(f.statuses);
    return rowsWithStatus.filter((row) => want.has(row.status));
  }
  return rowsWithStatus;
}

// =====================================================================
// Per-CAMPAIGN rows (2026-11) — the Campaigns list. A campaign is a
// `parent_campaigns` row; its numbers are the component sums of every record
// of its ad sets (never a roll-up of per-ad-set ratios).
// =====================================================================

export interface PortfolioParentRow extends PortfolioCampaignRow {
  /** `campaignId` is the CAMPAIGN's id and `campaign` its own name here. */
  network: AdNetwork;
  /** Registered ad sets — the registry count, whatever the filters say. */
  adSets: number;
  /** The objectives its ad sets carry, in vocabulary order (`objective` = the first). */
  objectives: CampaignObjective[];
  /** False for a campaign with no record in the range (a never-run one is listed too). */
  hasData: boolean;
}

/**
 * The Campaigns list. Same filters and the same narrowing as the ad-set list
 * (`baseConds`): a platform or objective filter narrows the RECORDS, so a
 * campaign's row totals what matches. Status = active when ANY ad set is
 * (rolled up from the one cached `campaignStatusMap()` — no new scan).
 *
 * REGISTRY-AWARE: a campaign that has NEVER had a record is listed too, with
 * no numbers — a just-registered campaign must be findable. One that has
 * records, but none in this range, is left out exactly like an ad set.
 */
export async function portfolioParentCampaigns(
  f: PortfolioFilters,
  range?: { from: string; to: string },
): Promise<PortfolioParentRow[]> {
  const acct = await getActiveAccountId();
  const r = range ?? { from: f.from, to: f.to };
  const [metricRows, registry, statusMap] = await Promise.all([
    db
      .select({
        parentId: campaigns.parentId,
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
        aov: aovSql,
        ctr: ctrSql,
        cpm: cpmSql,
        cvr: cvrSql,
        lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
        voc: vocSql,
        cpc: cpcSql,
        addToCart: sumAddToCart,
        addPayment: sumAddPayment,
        firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .where(and(...baseConds(f, r, acct)))
      .groupBy(campaigns.parentId),
    // The registry: every campaign with its ad sets, and whether each ad set
    // has ever had a record (an index probe per ad set, never a scan).
    db
      .select({
        parentId: parentCampaigns.id,
        name: parentCampaigns.name,
        network: parentCampaigns.network,
        createdAt: parentCampaigns.createdAt,
        adSetId: campaigns.id,
        adSetName: campaigns.name,
        objective: campaigns.objective,
        platform: campaigns.platform,
        everRan: sql<boolean>`EXISTS (
          SELECT 1 FROM performance_records pr3
          WHERE pr3.account_id = ${acct} AND pr3.campaign_id = ${campaigns.id}
        )`,
      })
      .from(parentCampaigns)
      .leftJoin(
        campaigns,
        and(eq(campaigns.parentId, parentCampaigns.id), eq(campaigns.accountId, acct)),
      )
      .where(eq(parentCampaigns.accountId, acct)),
    campaignStatusMap(),
  ]);

  interface Reg {
    name: string;
    network: AdNetwork;
    createdAt: Date;
    adSets: Array<{ id: string; name: string; objective: CampaignObjective; platform: Platform }>;
    everRan: boolean;
  }
  const reg = new Map<string, Reg>();
  for (const row of registry) {
    const entry: Reg = reg.get(row.parentId) ?? {
      name: row.name,
      network: row.network,
      createdAt: row.createdAt,
      adSets: [],
      everRan: false,
    };
    if (
      row.adSetId !== null &&
      row.adSetName !== null &&
      row.objective !== null &&
      row.platform !== null
    ) {
      entry.adSets.push({
        id: row.adSetId,
        name: row.adSetName,
        objective: row.objective,
        platform: row.platform,
      });
      if (row.everRan) entry.everRan = true;
    }
    reg.set(row.parentId, entry);
  }

  const facts = (parentId: string, entry: Reg) => {
    const objectives = campaignObjectiveEnum.filter((o) =>
      entry.adSets.some((a) => a.objective === o),
    );
    const status: CampaignStatus = entry.adSets.some(
      (a) => campaignStatusFor(statusMap, a.id) === "active",
    )
      ? "active"
      : "inactive";
    return {
      campaignId: parentId,
      campaign: entry.name,
      network: entry.network,
      adSets: entry.adSets.length,
      objectives,
      objective: objectives[0] ?? campaignObjectiveEnum[0],
      status,
      createdAt: entry.createdAt.toISOString(),
    };
  };

  const out: PortfolioParentRow[] = [];
  const seen = new Set<string>();
  for (const row of metricRows) {
    // An ad set the reconcile hasn't reached has no campaign yet — it shows
    // on the Ad sets list, and here once it has one.
    if (row.parentId === null) continue;
    const entry = reg.get(row.parentId);
    if (!entry) continue;
    seen.add(row.parentId);
    out.push({
      ...facts(row.parentId, entry),
      hasData: true,
      platforms: row.platforms ?? [],
      creatives: num(row.creatives),
      spend: num(row.spend),
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      lpv: numOrNull(row.lpv),
      orders: num(row.orders),
      revenue: num(row.revenue),
      cpa: numOrNull(row.cpa),
      roas: numOrNull(row.roas),
      aov: numOrNull(row.aov),
      ctr: numOrNull(row.ctr),
      cpm: numOrNull(row.cpm),
      cvr: numOrNull(row.cvr),
      lastDate: row.lastDate,
      voc: numOrNull(row.voc),
      cpc: numOrNull(row.cpc),
      addToCart: numOrNull(row.addToCart),
      addPayment: numOrNull(row.addPayment),
      firstDate: row.firstDate,
    });
  }
  out.sort((a, b) => b.spend - a.spend);

  // The never-run campaigns, after the ones with data — held to the SAME
  // filters, read off the registry (there are no records to narrow).
  const q = f.q?.trim().toLowerCase();
  const wantPlatforms = f.platforms ?? [];
  const wantObjectives = f.objectives ?? [];
  const never: PortfolioParentRow[] = [];
  for (const [parentId, entry] of reg) {
    if (seen.has(parentId) || entry.everRan) continue;
    const platforms = [...new Set(entry.adSets.map((a) => a.platform))];
    if (wantPlatforms.length > 0) {
      const where = platforms.length > 0 ? platforms : networkPlatforms(entry.network);
      if (!where.some((p) => wantPlatforms.includes(p))) continue;
    }
    if (
      wantObjectives.length > 0 &&
      !entry.adSets.some((a) => wantObjectives.includes(a.objective))
    ) {
      continue;
    }
    if (q) {
      const hit =
        entry.name.toLowerCase().includes(q) ||
        entry.adSets.some((a) => a.name.toLowerCase().includes(q));
      if (!hit) continue;
    }
    never.push({
      ...facts(parentId, entry),
      hasData: false,
      platforms,
      creatives: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      lpv: null,
      orders: 0,
      revenue: 0,
      cpa: null,
      roas: null,
      aov: null,
      ctr: null,
      cpm: null,
      cvr: null,
      lastDate: null,
      voc: null,
      cpc: null,
      addToCart: null,
      addPayment: null,
      firstDate: null,
    });
  }
  never.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const rows = [...out, ...never];
  if (f.statuses && f.statuses.length > 0) {
    const want = new Set(f.statuses);
    return rows.filter((row) => want.has(row.status));
  }
  return rows;
}
