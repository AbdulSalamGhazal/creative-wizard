import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import {
  BUDGET_OBJECTIVES,
  monthsInRange,
} from "@/lib/budget";
import { ALL_PLATFORMS } from "@/lib/palette";
import {
  resolveBudgetRange,
  PACING_BOARDS,
  PACING_GROUPS,
  PACING_RANKS,
  PACING_SHAPES,
  PACING_SPLITS,
  ANALYSIS_LENSES,
  RESULT_BYS,
  pacingViewSchema,
} from "@/validators/budget";
import {
  budgetPacingSeries,
  budgetPlansForMonths,
  budgetProductSeries,
  getUsdToSarRate,
} from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetPacing, type GroupBy } from "@/components/budget/budget-pacing";
import { resolveFilterPrefs } from "@/db/queries/user-prefs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget · Analysis" };

const GROUP_BYS: GroupBy[] = ["day", "week", "month"];

/**
 * Budget → Analysis (the Pacing page until 2026-11-14) — any date range, two
 * lenses. PACING: plan vs actual grouped by day, calendar week or month,
 * optionally filtered to a platform subset and split by Budget's objective
 * buckets, the expected-to-actual waterfall, one small chart per platform and
 * the BOARD. RESULTS: what the platforms report the spend bought, by
 * platform, objective or product.
 *
 * The range is URL-backed so a view is shareable. Three fallbacks, in order:
 * an explicit from/to; a `?month=`; else the current month.
 */
export default async function BudgetAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    month?: string;
    groupBy?: string;
    platforms?: string;
    split?: string;
    shape?: string;
    lens?: string;
    by?: string;
    board?: string;
    rank?: string;
    group?: string;
    buckets?: string;
    offpace?: string;
  }>;
}) {
  const sp = await searchParams;
  const today = todayIso();

  const { from, to } = resolveBudgetRange(sp, today);

  const groupBy: GroupBy = (GROUP_BYS as string[]).includes(sp.groupBy ?? "")
    ? (sp.groupBy as GroupBy)
    : "day";

  // REMEMBERED FILTERS (migration 0049): the platform picker is the only filter
  // on this page, and it is remembered per user per brand — URL wins, else the
  // saved value, else all platforms.
  // REMEMBERED (0049): the platform filter, the chart's two view controls
  // (`split`, `shape`) and — since the Tracker merged in — the board's three
  // (`board`, `rank`, `group`) and its two tier-2 filters (`buckets`,
  // `offpace`), URL → this user's saved value → the default. The keys are the
  // Tracker's, so a choice remembered there carries over.
  const raw = sp as Record<string, string | undefined>;
  const pref = await resolveFilterPrefs(
    [
      { key: "platforms", allow: ALL_PLATFORMS },
      { key: "split", allow: PACING_SPLITS },
      { key: "shape", allow: PACING_SHAPES },
      { key: "buckets", allow: BUDGET_OBJECTIVES },
      { key: "offpace", allow: ["1"] },
      { key: "board", allow: PACING_BOARDS },
      { key: "rank", allow: PACING_RANKS },
      { key: "group", allow: PACING_GROUPS },
      { key: "lens", allow: ANALYSIS_LENSES },
      { key: "by", allow: RESULT_BYS },
    ],
    (key) => raw[key],
  );
  const platformsParam = pref.platforms;
  const view = pacingViewSchema.parse({
    split: pref.split,
    shape: pref.shape,
    buckets: pref.buckets,
    offpace: pref.offpace,
    board: pref.board,
    rank: pref.rank,
    group: pref.group,
    lens: pref.lens,
    by: pref.by,
  });

  const platforms = (platformsParam ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is (typeof ALL_PLATFORMS)[number] =>
      (ALL_PLATFORMS as readonly string[]).includes(p),
    );

  // Ads and store data are uploaded separately, so each side is gated by its
  // OWN horizon — otherwise a brand with orders but no ad exports (or the
  // reverse) sees an all-dashes page despite having real data. The ads side
  // is read PER PLATFORM and every comparison on the page anchors each
  // platform to its own day (W1-2); the component derives the in-scope
  // "data through" from the same read.
  // The product scan runs only when the page is showing products — the
  // default stays at the two scans every other view needs.
  const wantsProducts = view.lens === "results" && view.by === "product";
  const [series, plans, rate, platformCoverage, storeHorizon, user, products] = await Promise.all([
    budgetPacingSeries(from, to),
    budgetPlansForMonths(monthsInRange(from, to)),
    getUsdToSarRate(),
    platformHorizons(),
    storeDataHorizon(),
    auth(),
    wantsProducts ? budgetProductSeries(from, to) : Promise.resolve(null),
  ]);
  const canManage = user ? can(user, "budget.manage") : false;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Analysis"
        info="Spend is raw, unfiltered totals. Results are what the ad platforms report."
      />
      <BudgetPacing
        from={from}
        to={to}
        groupBy={groupBy}
        platforms={platforms}
        split={view.split}
        shape={view.shape}
        view={view}
        resolved={pref}
        coverage={platformCoverage}
        canManage={canManage}
        products={products}
        series={series}
        plans={plans}
        rate={rate}
        today={today}
        storeHorizon={storeHorizon}
      />
    </PageShell>
  );
}
