import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthKey } from "@/lib/budget";
import { budgetDailySeries, getBudgetMonth } from "@/db/queries/budget";
import { dataHorizon } from "@/db/queries/series-bounds";
import { BudgetDaily } from "@/components/budget/budget-daily";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget daily" };

const MONTH = /^\d{4}-\d{2}$/;

/**
 * Budget Daily — day-by-day spend and store revenue against the day-weight
 * plan curve, with a cumulative chart. Spend is RAW (no exclusion filtering —
 * standing decision); revenue is store facts (SAR). Days past the data horizon
 * are unknown, not zero.
 */
export default async function BudgetDailyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.month && MONTH.test(sp.month) ? sp.month : monthKey(today);

  const [data, daily, horizon] = await Promise.all([
    getBudgetMonth(month),
    budgetDailySeries(month),
    dataHorizon(),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Daily"
        subtitle="Each day's spend and store revenue against the plan curve — cumulative actual vs plan-to-date, with weighted (payday) days marked."
      />
      <BudgetDaily month={month} today={today} data={data} daily={daily} horizon={horizon} />
    </PageShell>
  );
}
