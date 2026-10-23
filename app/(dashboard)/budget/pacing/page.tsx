import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import {
  BUDGET_OBJECTIVES,
  clampRangeMonths,
  isValidIsoDate,
  monthEndIso,
  monthKey,
  monthStartIso,
  monthsInRange,
  prevMonthKey,
} from "@/lib/budget";
import { ALL_PLATFORMS } from "@/lib/palette";
import {
  MONTH_KEY,
  PACING_BOARDS,
  PACING_GROUPS,
  PACING_RANKS,
  PACING_SHAPES,
  PACING_SPLITS,
  pacingViewSchema,
} from "@/validators/budget";
import { budgetPacingSeries, budgetPlansForMonths, getUsdToSarRate } from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetPacing, type GroupBy } from "@/components/budget/budget-pacing";
import { resolveFilterPrefs } from "@/db/queries/user-prefs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pacing" };

const GROUP_BYS: GroupBy[] = ["day", "week", "month"];

/**
 * Budget Pacing — plan vs actual over any date range, grouped by day, calendar
 * week or month, optionally filtered to a platform subset and broken down by
 * Budget's objective buckets — and, since the Tracker merged in (2026-10-19),
 * the BOARD: every platform's pace for the range with its stages.
 *
 * The range is URL-backed so a view is shareable. Three fallbacks, in order:
 * an explicit from/to; the `?month=` the Budget nav links carry; else the
 * current month. `granularity=monthly` is the retired History link's shape —
 * it lands on the last twelve months grouped by month, which is what that page
 * used to show.
 */
export default async function BudgetPacingPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    month?: string;
    groupBy?: string;
    granularity?: string;
    platforms?: string;
    split?: string;
    shape?: string;
    board?: string;
    rank?: string;
    group?: string;
    buckets?: string;
    offpace?: string;
  }>;
}) {
  const sp = await searchParams;
  const today = todayIso();

  const legacyHistory = sp.granularity === "monthly" && !sp.from && !sp.to;
  let from: string;
  let to: string;
  if (isValidIsoDate(sp.from) && isValidIsoDate(sp.to) && sp.from <= sp.to) {
    // A hand-edited or stale URL degrades to the default range rather than
    // reaching the database as a bad date literal.
    ({ from, to } = clampRangeMonths(sp.from, sp.to));
  } else if (legacyHistory) {
    // The old History page: twelve months back through the end of this one.
    let month = monthKey(today);
    for (let i = 0; i < 11; i++) month = prevMonthKey(month);
    from = monthStartIso(month);
    to = monthEndIso(monthKey(today));
  } else {
    const month = sp.month && MONTH_KEY.test(sp.month) ? sp.month : monthKey(today);
    from = monthStartIso(month);
    to = monthEndIso(month);
  }

  const groupBy: GroupBy = (GROUP_BYS as string[]).includes(sp.groupBy ?? "")
    ? (sp.groupBy as GroupBy)
    : legacyHistory
      ? "month"
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
  const [series, plans, rate, platformCoverage, storeHorizon, user] = await Promise.all([
    budgetPacingSeries(from, to),
    budgetPlansForMonths(monthsInRange(from, to)),
    getUsdToSarRate(),
    platformHorizons(),
    storeDataHorizon(),
    auth(),
  ]);
  const canManage = user ? can(user, "budget.manage") : false;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Pacing"
        subtitle="Actual against the plan curve over any range — the range card, the chart, and the pace board: every platform's bar with its daily sparkline and what each remaining day needs. Spend is raw, unfiltered totals."
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
        series={series}
        plans={plans}
        rate={rate}
        today={today}
        storeHorizon={storeHorizon}
      />
    </PageShell>
  );
}
