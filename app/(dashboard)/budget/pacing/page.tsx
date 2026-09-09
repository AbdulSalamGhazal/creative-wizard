import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import {
  daysInMonth,
  monthKey,
  monthStartIso,
  monthsInRange,
  prevMonthKey,
} from "@/lib/budget";
import { ALL_PLATFORMS } from "@/lib/palette";
import { budgetPacingSeries, budgetPlansForMonths, getUsdToSarRate } from "@/db/queries/budget";
import { dataHorizon, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetPacing, type GroupBy } from "@/components/budget/budget-pacing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pacing" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const GROUP_BYS: GroupBy[] = ["day", "week", "month"];

/** Last day of the month a YYYY-MM key names. */
function monthEndIso(month: string): string {
  const start = monthStartIso(month);
  return `${start.slice(0, 8)}${daysInMonth(start)}`;
}

/**
 * Budget Pacing — plan vs actual over any date range, grouped by day, calendar
 * week or month, optionally filtered to a platform subset and broken down by
 * Budget's objective buckets.
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
  }>;
}) {
  const sp = await searchParams;
  const today = todayIso();

  const legacyHistory = sp.granularity === "monthly" && !sp.from && !sp.to;
  let from: string;
  let to: string;
  if (sp.from && ISO.test(sp.from) && sp.to && ISO.test(sp.to) && sp.from <= sp.to) {
    from = sp.from;
    to = sp.to;
  } else if (legacyHistory) {
    // The old History page: twelve months back through the end of this one.
    let month = monthKey(today);
    for (let i = 0; i < 11; i++) month = prevMonthKey(month);
    from = monthStartIso(month);
    to = monthEndIso(monthKey(today));
  } else {
    const month = sp.month && MONTH.test(sp.month) ? sp.month : monthKey(today);
    from = monthStartIso(month);
    to = monthEndIso(month);
  }

  const groupBy: GroupBy = (GROUP_BYS as string[]).includes(sp.groupBy ?? "")
    ? (sp.groupBy as GroupBy)
    : legacyHistory
      ? "month"
      : "day";

  const platforms = (sp.platforms ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is (typeof ALL_PLATFORMS)[number] =>
      (ALL_PLATFORMS as readonly string[]).includes(p),
    );

  // Ads and store data are uploaded separately, so each side is gated by its
  // OWN horizon — otherwise a brand with orders but no ad exports (or the
  // reverse) sees an all-dashes page despite having real data.
  const [series, plans, rate, horizon, storeHorizon] = await Promise.all([
    budgetPacingSeries(from, to),
    budgetPlansForMonths(monthsInRange(from, to)),
    getUsdToSarRate(),
    dataHorizon(),
    storeDataHorizon(),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Pacing"
        subtitle="Actual against the plan curve over any range — grouped by day, week or month, filtered by platform, and broken down by objective. Actuals are raw totals (exclusions don't apply here)."
      />
      <BudgetPacing
        from={from}
        to={to}
        groupBy={groupBy}
        platforms={platforms}
        series={series}
        plans={plans}
        rate={rate}
        horizon={horizon}
        storeHorizon={storeHorizon}
      />
    </PageShell>
  );
}
