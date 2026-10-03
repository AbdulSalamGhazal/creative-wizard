import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { latestCoverage, monthKey } from "@/lib/budget";
// Month 01-12 only — `2026-13` must fall back to the current month, not
// produce a nonsense one. One regex, in the validators.
import { MONTH_KEY } from "@/validators/budget";
import { getBudgetMonth, plannedMonths } from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetOverview } from "@/components/budget/budget-overview";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Overview" };

/**
 * Budget Overview — the month's read-only verdict: plan vs actual with curve-
 * based pacing and month-end projections, the reserve line, and per-platform
 * cards linking into the Plan editor. Actuals are RAW (no exclusion filtering
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
  const month = sp.month && MONTH_KEY.test(sp.month) ? sp.month : monthKey(today);

  const user = await auth();
  const canManage = user ? can(user, "budget.manage") : false;
  // Ads and store data arrive on separate schedules, so the horizon note needs
  // BOTH — this page reports revenue and orders alongside spend.
  // PER-PLATFORM coverage, not one overall horizon: every pacing comparison on
  // this page anchors to the days a platform's data actually covers, and the
  // note's "data through" is the latest of them — so this replaces the old
  // `dataHorizon()` call rather than adding a query.
  const [data, coverage, storeHorizon, months] = await Promise.all([
    getBudgetMonth(month),
    platformHorizons(),
    storeDataHorizon(),
    // One cheap month-grain query, for the rollover nudge on an empty month.
    plannedMonths(),
  ]);
  const seedMonth = months.find((m) => m < month) ?? null;
  const horizon = latestCoverage(coverage);

  return (
    <PageShell>
      {/* Anchored to the month in view: a comment on September stays on
          September when you step to October. */}
      <CommentAnchor type="budget_month" id={month} />
      <PageHeader
        eyebrow="Budget"
        title="Overview"
        subtitle="The month at a glance — spend and revenue vs plan, paced by the plan curve set on the Plan page, with a month-end projection. Actuals are raw totals (exclusions don't apply here)."
      />
      <BudgetOverview
        month={month}
        today={today}
        data={data}
        horizon={horizon}
        coverage={coverage}
        storeHorizon={storeHorizon}
        seedMonth={seedMonth}
        canManage={canManage}
      />

    </PageShell>
  );
}
