import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthKey } from "@/lib/budget";
// Month 01-12 only — `2026-13` must fall back to the current month, not
// produce a nonsense one. One regex, in the validators.
import { MONTH_KEY } from "@/validators/budget";
import { getBudgetMonth } from "@/db/queries/budget";
import { dataHorizon, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetOverview } from "@/components/budget/budget-overview";

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
  const [data, horizon, storeHorizon] = await Promise.all([
    getBudgetMonth(month),
    dataHorizon(),
    storeDataHorizon(),
  ]);

  return (
    <PageShell>
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
        storeHorizon={storeHorizon}
        canManage={canManage}
      />
    </PageShell>
  );
}
