import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import {
  BUDGET_OBJECTIVES,
  REVENUE_COVERAGE_KEY,
  latestCoverage,
  monthKey,
} from "@/lib/budget";
import { ALL_PLATFORMS } from "@/lib/palette";
import { resolveFilterPrefs } from "@/db/queries/user-prefs";
import {
  TRACKER_BOARDS,
  TRACKER_RANKS,
  trackerFiltersSchema,
} from "@/validators/budget";
// Month 01-12 only — `2026-13` must fall back to the current month, not
// produce a nonsense one. One regex, in the validators.
import { MONTH_KEY } from "@/validators/budget";
import { getBudgetMonth } from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetTracker } from "@/components/budget/budget-tracker";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tracker" };

/**
 * Budget Tracker — the daily pace board: who's ahead, who's behind, by how
 * much. The BARE page is still the zero-configuration board it has always been
 * (Pacing is the analysis tool; Overview is the month's verdict) — the controls
 * added in 2026-10 are opt-in and remembered, so nobody has to configure
 * anything to read it.
 *
 * Everything derives from the SAME `getBudgetMonth()` payload the other pages
 * read; the only addition is the per-platform coverage the pacing anchors to.
 */
type SearchParams = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BudgetTrackerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const monthParam = pick(sp.month);
  const month = monthParam && MONTH_KEY.test(monthParam) ? monthParam : monthKey(today);

  // REMEMBERED CONTROLS (0049): URL → this user's saved value for this brand →
  // the zero-config default. The bare page is the Tracker's identity, so every
  // control below is opt-in — and once opted into, it stays chosen.
  const pref = await resolveFilterPrefs(
    [
      { key: "platforms", allow: ALL_PLATFORMS },
      { key: "buckets", allow: BUDGET_OBJECTIVES },
      { key: "offpace", allow: ["1"] },
      { key: "board", allow: TRACKER_BOARDS },
      { key: "rank", allow: TRACKER_RANKS },
    ],
    (key: string) => pick(sp[key]),
  );
  const filters = trackerFiltersSchema.parse({
    platforms: pref.platforms,
    buckets: pref.buckets,
    offpace: pref.offpace,
    board: pref.board,
    rank: pref.rank,
  });

  const user = await auth();
  const canManage = user ? can(user, "budget.manage") : false;
  // PER-PLATFORM coverage — the pacing anchor (2026-10). Spend and revenue
  // arrive on separate schedules and so do the platforms, so each side is
  // compared through the days ITS data covers; the overall "data through" is
  // just the latest of them, which is why this replaces the old
  // `dataHorizon()` call rather than adding a query.
  const [data, platformCoverage, storeHorizon] = await Promise.all([
    getBudgetMonth(month),
    platformHorizons(),
    storeDataHorizon(),
  ]);
  const horizon = latestCoverage(platformCoverage);
  const coverage = { ...platformCoverage, [REVENUE_COVERAGE_KEY]: storeHorizon };

  return (
    <PageShell>
      {/* Anchored to the month in view, like Overview and Plan. */}
      <CommentAnchor type="budget_month" id={month} />
      <PageHeader
        eyebrow="Budget"
        title="Tracker"
        subtitle="Where every planned line stands today: the bar is the month's plan, the fill is what's been spent, and the tick is where the plan curve says you should be. Actuals are raw totals (exclusions don't apply here)."
      />
      <BudgetTracker
        month={month}
        today={today}
        data={data}
        horizon={horizon}
        storeHorizon={storeHorizon}
        coverage={coverage}
        filters={filters}
        resolvedFilters={pref}
        canManage={canManage}
      />
    </PageShell>
  );
}
