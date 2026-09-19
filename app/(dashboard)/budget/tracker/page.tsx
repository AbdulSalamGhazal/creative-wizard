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
import { BudgetTracker } from "@/components/budget/budget-tracker";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tracker" };

/**
 * Budget Tracker — the zero-configuration daily pace board: who's ahead,
 * who's behind, by how much. No filters, no dimensions, no date range: the
 * month and the currency are the only controls, and that absence is the point
 * (Pacing is the analysis tool; Overview is the month's verdict). Everything
 * derives from the SAME `getBudgetMonth()` payload the other pages read —
 * no new queries.
 */
export default async function BudgetTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.month && MONTH_KEY.test(sp.month) ? sp.month : monthKey(today);

  const user = await auth();
  const canManage = user ? can(user, "budget.manage") : false;
  // Spend and revenue arrive on separate schedules, so the horizon note needs
  // BOTH — this page paces against each of them.
  const [data, horizon, storeHorizon] = await Promise.all([
    getBudgetMonth(month),
    dataHorizon(),
    storeDataHorizon(),
  ]);

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
        canManage={canManage}
      />
    </PageShell>
  );
}
