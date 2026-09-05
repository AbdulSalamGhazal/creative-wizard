import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthKey } from "@/lib/budget";
import { getBudgetMonth } from "@/db/queries/budget";
import { BudgetView } from "@/components/budget/budget-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget" };

const MONTH = /^\d{4}-\d{2}$/;

/**
 * Budget — monthly spend plan (USD, per platform → objective) vs actual, and a
 * single monthly revenue target (SAR) vs the store's actuals. Actuals are RAW
 * (no exclusion filtering — standing decision, see db/queries/budget.ts).
 * Viewing is open to any signed-in brand member; editing needs budget.manage.
 */
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.month && MONTH.test(sp.month) ? sp.month : monthKey(today);

  const user = await auth();
  const canManage = user ? can(user, "budget.manage") : false;
  const data = await getBudgetMonth(month);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Ads"
        title="Budget"
        subtitle="Monthly spend plan vs actual by platform and objective, and the month's revenue target. Actuals are raw totals (exclusions don't apply here)."
      />
      <BudgetView month={month} today={today} data={data} canManage={canManage} />
    </PageShell>
  );
}
