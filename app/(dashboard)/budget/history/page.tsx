import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { budgetHistory, getUsdToSarRate } from "@/db/queries/budget";
import { BudgetHistory } from "@/components/budget/budget-history";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget history" };

/**
 * Budget History — every month with a plan or actuals, newest first: planned
 * vs actual spend and revenue, variance, and ROAS through the brand rate.
 * Read-only; month links jump to that month's Overview.
 */
export default async function BudgetHistoryPage() {
  const [rows, rate] = await Promise.all([budgetHistory(), getUsdToSarRate()]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="History"
        subtitle="Month by month — planned vs actual spend and revenue, variance, and ROAS via the brand rate. Actuals are raw totals (exclusions don't apply here)."
      />
      <BudgetHistory rows={rows} rate={rate} />
    </PageShell>
  );
}
