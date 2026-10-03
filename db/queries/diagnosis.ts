import { and, between, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { sumSpend, sumConversionValue } from "@/lib/metrics";
import {
  campaignAnalytics,
  campaignCreatives,
  campaignDailyByCreative,
  campaignMeta,
  campaignRecordsByDay,
  campaignRegistry,
} from "@/db/queries/campaign";
import { campaignStatusMap, campaignStatusFor } from "@/db/queries/campaign-status";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import { listCreatives } from "@/db/queries/creatives";
import { kpis } from "@/db/queries/performance";
import { funnelOverview } from "@/db/queries/funnel";
import { getRatingConfig } from "@/db/queries/rating";
import { platformHorizons } from "@/db/queries/series-bounds";
import { getBudgetMonth } from "@/db/queries/budget";
import { rulesForScope } from "@/lib/rating";
import {
  buildPlanSeries,
  daysInMonth,
  makeCoverageDay,
  monthKey,
  monthStartIso,
  planSeriesSourceOf,
  toBudgetObjective,
} from "@/lib/budget";
import {
  CREATIVE_DAILY_DAYS,
  type DiagnosisCreativeInput,
  type DiagnosisInput,
  MAX_DIAGNOSIS_WEEKS,
} from "@/lib/diagnosis";
import type { Account } from "@/lib/tenant";

/**
 * Assembly for the AI campaign diagnosis bundle. Every number here comes from a
 * query the pages already use — this module's only job is to fetch the pieces,
 * account-scoped, and hand them to the PURE serializer (`lib/diagnosis.ts`).
 *
 * It is a ONE-SHOT diagnostic read, so it costs more round-trips than a page
 * would (`lib/db.ts` is `max: 1`, so they are serial): about a dozen, each
 * bounded by the window, the campaign, or the brand's own catalog. That is the
 * trade this tool exists to make — one call that needs no follow-ups.
 *
 * READ-ONLY, like everything the MCP server can reach. Nothing here writes.
 */

const ISO_DAY_MS = 86_400_000;

function shiftIso(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * ISO_DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Per-creative totals ELSEWHERE in the window: the same creatives, every
 * campaign, so the bundle can say "this creative also spent $X at 3.1× in two
 * other campaigns" — the context that decides whether a weak row here is a
 * weak creative or a weak placement.
 *
 * The one query this module adds, because nothing existing groups creative ×
 * campaign: bounded by the window AND by the creative ids already selected.
 */
async function creativeSpread(
  creativeIds: string[],
  from: string,
  to: string,
  includeExcluded: boolean,
): Promise<Map<string, { spend: number; revenue: number; campaigns: number }>> {
  if (creativeIds.length === 0) return new Map();
  const acct = await getActiveAccountId();
  const conds = [
    eq(performanceRecords.accountId, acct),
    inArray(performanceRecords.creativeId, creativeIds),
    between(performanceRecords.date, from, to),
  ];
  if (!includeExcluded) {
    conds.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  const rows = await db
    .select({
      creativeId: performanceRecords.creativeId,
      spend: sumSpend,
      revenue: sumConversionValue,
      campaigns: sql<number>`COUNT(DISTINCT ${performanceRecords.campaignId})::int`,
    })
    .from(performanceRecords)
    .where(and(...conds))
    .groupBy(performanceRecords.creativeId);
  return new Map(
    rows.map((r) => [
      r.creativeId,
      {
        spend: Number(r.spend ?? 0),
        revenue: Number(r.revenue ?? 0),
        campaigns: Number(r.campaigns ?? 0),
      },
    ]),
  );
}

export interface DiagnosisOptions {
  windowDays: number;
  includeExcluded: boolean;
  /** Today, injected so the bundle is reproducible in tests. */
  todayIso: string;
}

/**
 * Gather everything one campaign's diagnosis needs. Returns null when the name
 * isn't a campaign of the ACTIVE brand — the caller turns that into an error
 * naming `list_campaigns` (the FK-revalidation discipline: a name from a
 * client is re-checked account-scoped before anything is built from it).
 */
export async function campaignDiagnosisInput(
  brand: Account,
  campaignName: string,
  opts: DiagnosisOptions,
): Promise<DiagnosisInput | null> {
  const meta = await campaignMeta(campaignName);
  if (!meta) return null;

  const to = opts.todayIso;
  const from = shiftIso(to, -(opts.windowDays - 1));
  // One daily read covering the window AND the weeks before it; the serializer
  // splits them (daily inside, weekly outside) so this stays one round-trip.
  const historyFrom = shiftIso(from, -(MAX_DIAGNOSIS_WEEKS * 7));
  const window = { from, to, days: opts.windowDays };
  const platform = meta.platforms[0] ?? null;

  const [registry, days, lifetime, inCampaign, creativeDaily, library, ratingConfig, coverage] =
    await Promise.all([
      campaignRegistry(campaignName),
      campaignRecordsByDay(
        campaignName,
        { from: historyFrom, to },
        opts.includeExcluded,
      ),
      campaignAnalytics(campaignName, {}, opts.includeExcluded),
      campaignCreatives(campaignName, window, opts.includeExcluded),
      campaignDailyByCreative(
        campaignName,
        { from: shiftIso(to, -(CREATIVE_DAILY_DAYS - 1)), to },
        opts.includeExcluded,
      ),
      // The library in one read (the Library page's own query) — identity,
      // stages, priority, angles and launch date for every creative, indexed
      // by id below. Cheaper than 20 per-creative lookups.
      listCreatives({ sort: "spend-desc" }),
      getRatingConfig(),
      platformHorizons(),
    ]);

  const status = registry
    ? campaignStatusFor(await campaignStatusMap([registry.id]), registry.id)
    : null;

  const creativeIds = inCampaign.map((c) => c.creativeId);
  const [spread, statusMap] = await Promise.all([
    creativeSpread(creativeIds, from, to, opts.includeExcluded),
    creativeStatusMap(creativeIds),
  ]);

  const libraryById = new Map(library.rows.map((r) => [r.id, r]));
  const dailyByCreative = new Map<string, DiagnosisCreativeInput["daily"]>();
  for (const p of creativeDaily) {
    const list = dailyByCreative.get(p.creativeId) ?? [];
    // Sums only — the serializer's contract: a reader recomputes any ratio
    // from these, which is the rule the conventions block states anyway.
    list.push({
      date: p.date,
      spend: p.spend,
      impressions: p.impressions,
      clicks: p.clicks,
      conversions: p.conversions,
      revenue: p.conversionValue,
    });
    dailyByCreative.set(p.creativeId, list);
  }

  const creativeRows: DiagnosisCreativeInput[] = inCampaign.map((c) => {
    const lib = libraryById.get(c.creativeId);
    const elsewhereTotals = spread.get(c.creativeId);
    const spendElsewhere = Math.max(0, (elsewhereTotals?.spend ?? 0) - c.spend);
    const revenueElsewhere = Math.max(
      0,
      (elsewhereTotals?.revenue ?? 0) - c.conversionValue,
    );
    return {
      creativeId: c.creativeId,
      name: c.name,
      type: c.type,
      statusHere: c.status,
      statusGeneral: statusFor(statusMap, c.creativeId).general,
      stages: lib?.stages ?? [],
      priority: lib?.priority ?? null,
      angles: lib?.angles ?? [],
      launchDate: lib?.launchDate ?? null,
      product: lib?.productName ?? null,
      inCampaign: {
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        revenue: c.conversionValue,
        ctr: c.ctr,
        cvr: c.cvr,
        cpa: c.cpa,
        roas: c.roas,
        lastDate: c.lastDate,
      },
      daily: dailyByCreative.get(c.creativeId) ?? [],
      elsewhere: {
        spend: spendElsewhere,
        revenue: revenueElsewhere,
        roas: spendElsewhere > 0 ? revenueElsewhere / spendElsewhere : null,
        campaigns: elsewhereTotals?.campaigns ?? 0,
      },
    };
  });

  // Benchmarks: the SAME brand, the SAME platform, the SAME window — the only
  // comparison this system can honestly make.
  const platformFilter = platform ? { platforms: [platform] } : {};
  const [brandKpis, funnel] = await Promise.all([
    kpis({ from, to, ...platformFilter, includeExcluded: opts.includeExcluded }),
    funnelOverview({ from, to, ...platformFilter, includeExcluded: opts.includeExcluded }),
  ]);

  // Budget: this campaign's bucket, that bucket × platform, measured at the
  // platform's COVERAGE day (never the calendar — the module's standing rule).
  const month = monthKey(to);
  const budgetMonth = await getBudgetMonth(month);
  const bucket = toBudgetObjective(meta.objective);
  const series = buildPlanSeries(planSeriesSourceOf(budgetMonth, month));
  const coverageDay = makeCoverageDay(month, to, coverage);
  const plan =
    platform === null
      ? null
      : budgetMonth.allocations
          .filter((a) => a.platform === platform && a.objective === bucket)
          .reduce((s, a) => s + a.plannedSpend, 0);
  const actual =
    platform === null
      ? null
      : budgetMonth.actualSpendByCombo
          .filter((a) => a.platform === platform && a.objective === bucket)
          .reduce((s, a) => s + a.actualSpend, 0);
  const day = platform ? coverageDay(platform) : null;

  // The rating rules this platform is judged by (the brand default unless it
  // has an override) — the bundle's "too small to judge" threshold.
  const rules = rulesForScope(ratingConfig, platform ?? "total");

  return {
    generatedAt: new Date().toISOString(),
    brand: { id: brand.id, name: brand.name },
    campaign: {
      name: meta.campaign,
      objective: meta.objective,
      platform,
      platforms: meta.platforms,
      status,
      products: meta.productNames,
      creativeCount: meta.creativeCount,
      firstDate: meta.firstDate,
      lastDate: meta.lastDate,
    },
    window,
    excludedRecords: opts.includeExcluded ? "included" : "hidden",
    coverage,
    days,
    lifetime: lifetime.totals as unknown as Record<string, number | null>,
    creatives: creativeRows,
    creativesTotal: creativeRows.length,
    benchmarks: {
      platform,
      spend: brandKpis.spend,
      cpm: brandKpis.cpm,
      ctr: brandKpis.ctr,
      cvr: brandKpis.cvr,
      roas: brandKpis.roas,
      aov:
        brandKpis.conversions && brandKpis.conversionValue
          ? brandKpis.conversionValue / brandKpis.conversions
          : null,
      funnel: {
        voc: funnel.current.voc,
        atcRate: funnel.current.atcRate,
        apRate: funnel.current.apRate,
        purchaseRate: funnel.current.purchaseRate,
        cvr: funnel.current.cvr,
        ctr: funnel.current.ctr,
        cpm: funnel.current.cpm,
      },
    },
    budget:
      platform === null
        ? null
        : {
            month,
            planMode: budgetMonth.planMode,
            bucket,
            platform,
            plan,
            expectedAtCoverage:
              plan === null || day === null
                ? null
                : series.spendToDate(
                    plan,
                    day,
                    (p, o) => p === platform && o === bucket,
                  ),
            actual,
            coverageDay: day,
            totalDays: daysInMonth(monthStartIso(month)),
          },
    conventions: {
      usdToSarRate: budgetMonth.usdToSarRate,
      minSpendToJudge: rules.minSpend,
      goodRoas: rules.goodRoas,
      decentRoas: rules.decentRoas,
    },
  };
}
