import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import {
  REVENUE_COVERAGE_KEY,
  latestCoverage,
  monthEndIso,
  monthStartIso,
} from "@/lib/budget";
// Month 01-12 only — `2026-13` must fall back to the current month, not
// produce a nonsense one. One regex, in the validators.
import { resolveBudgetMonth } from "@/validators/budget";
import { budgetPacingSeries, getBudgetMonth, plannedMonths } from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetOverview } from "@/components/budget/budget-overview";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Overview" };

/**
 * Budget Overview — the month at a glance (rebuilt 2026-10): three hero cards
 * (spend · revenue · ROAS against their plan/target, with projections), one
 * cumulative chart, and the pace board — every planned line's bar, most
 * off-pace first, the reserve last. Actuals are RAW (no exclusion filtering
 * — standing decision, see db/queries/budget.ts). Viewing is open to any
 * signed-in brand member; editing lives on /budget/plan behind budget.manage.
 */
export default async function BudgetOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const month = resolveBudgetMonth(sp.month, today);

  const user = await auth();
  const canManage = user ? can(user, "budget.manage") : false;
  // Ads and store data arrive on separate schedules, so the horizon note needs
  // BOTH — this page reports revenue and orders alongside spend.
  // PER-PLATFORM coverage, not one overall horizon: every pacing comparison on
  // this page anchors to the days a platform's data actually covers, and the
  // note's "data through" is the latest of them — so this replaces the old
  // `dataHorizon()` call rather than adding a query. The chart's per-day
  // actuals are the Pacing scan over this one month — the same two scans
  // Pacing runs, not a new one.
  const [data, platformCoverage, storeHorizon, months, series] = await Promise.all([
    getBudgetMonth(month),
    platformHorizons(),
    storeDataHorizon(),
    // One cheap month-grain query, for the rollover nudge on an empty month.
    plannedMonths(),
    budgetPacingSeries(monthStartIso(month), monthEndIso(month)),
  ]);
  const seedMonth = months.find((m) => m < month) ?? null;
  const horizon = latestCoverage(platformCoverage);
  // The store's coverage travels under its own key, so the revenue side paces
  // against ITS last uploaded day (the Tracker does the same).
  const coverage = { ...platformCoverage, [REVENUE_COVERAGE_KEY]: storeHorizon };

  return (
    <PageShell>
      {/* Anchored to the month in view: a comment on September stays on
          September when you step to October. */}
      <CommentAnchor type="budget_month" id={month} />
      <PageHeader
        eyebrow="Budget"
        title="Overview"
        subtitle="The month at a glance — spend, revenue and ROAS against the plan, paced by the plan curve set on the Plan page, with a month-end projection. Actuals are raw totals (exclusions don't apply here)."
      />
      <BudgetOverview
        month={month}
        today={today}
        data={data}
        series={series}
        horizon={horizon}
        coverage={coverage}
        storeHorizon={storeHorizon}
        seedMonth={seedMonth}
        canManage={canManage}
      />
    </PageShell>
  );
}
