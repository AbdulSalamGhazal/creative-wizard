import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthKey } from "@/lib/budget";
import { getBudgetMonth } from "@/db/queries/budget";
import { dataHorizon } from "@/db/queries/series-bounds";
import { BudgetOverview } from "@/components/budget/budget-overview";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget" };

const MONTH = /^\d{4}-\d{2}$/;

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
  const month = sp.month && MONTH.test(sp.month) ? sp.month : monthKey(today);

  const user = await auth();
  const canManage = user ? can(user, "budget.manage") : false;
  const [data, horizon] = await Promise.all([getBudgetMonth(month), dataHorizon()]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Budget"
        subtitle="The month at a glance — spend and revenue vs plan, paced along the day-weight curve, with a month-end projection. Actuals are raw totals (exclusions don't apply here)."
      />
      <BudgetOverview
        month={month}
        today={today}
        data={data}
        horizon={horizon}
        canManage={canManage}
      />
    </PageShell>
  );
}
