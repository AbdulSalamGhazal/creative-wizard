import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthKey } from "@/lib/budget";
// Month 01-12 only — `2026-13` must fall back to the current month, not
// produce a nonsense one. One regex, in the validators.
import { MONTH_KEY } from "@/validators/budget";
import { getBudgetMonth, listPlanRevisions, plannedMonths } from "@/db/queries/budget";
import { BudgetPlanEditor } from "@/components/budget/budget-plan-editor";

export const dynamic = "force-dynamic";

export const metadata = { title: "Plan" };

/**
 * Budget Plan — the month's editor and nothing else: USD allocations per
 * platform → objective, the SAR revenue target, the reserve budget, and the
 * day-weight plan curve. It is a PURE PLANNING surface — no actuals, no pacing
 * (those live on Overview). Viewing is open to any brand member; every edit
 * needs budget.manage, is audited under budget.update, and leaves a plan
 * revision that can be inspected and restored.
 */
export default async function BudgetPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.month && MONTH_KEY.test(sp.month) ? sp.month : monthKey(today);

  const user = await auth();
  const canManage = user ? can(user, "budget.manage") : false;
  const [data, months, revisions] = await Promise.all([
    getBudgetMonth(month),
    plannedMonths(),
    listPlanRevisions(month),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Plan"
        subtitle="Set the month's spend allocations, revenue target, reserve, and plan curve."
      />
      {/* Keyed by month: switching months must NEVER carry a draft across and
          save September's plan into October. The month bar is also locked
          while editing — belt and braces. */}
      <BudgetPlanEditor
        key={month}
        month={month}
        today={today}
        data={data}
        plannedMonths={months}
        revisions={revisions}
        canManage={canManage}
      />
    </PageShell>
  );
}
