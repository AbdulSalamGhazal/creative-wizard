import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthKey } from "@/lib/budget";
import { budgetHistory, budgetPacingSeries, getBudgetMonth } from "@/db/queries/budget";
import { dataHorizon, storeDataHorizon } from "@/db/queries/series-bounds";
import { BudgetPacing, type Granularity } from "@/components/budget/budget-pacing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pacing" };

// Month 01-12 only — `2026-13` would otherwise sail through and produce a
// nonsense month rather than falling back to the current one.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const GRANULARITIES: Granularity[] = ["daily", "weekly", "monthly"];

/**
 * Budget Pacing — plan vs actual, at whatever resolution is useful. Section one
 * checks the month's allocations (did the money go where the plan put it,
 * including the unplanned combos); section two compares over time by day,
 * calendar week, or across months, sliced by platform or objective.
 *
 * Replaced the separate Daily and History pages (2026-09); both still redirect
 * here. Spend is RAW (no exclusion filtering) and revenue is store facts in
 * SAR — both standing module decisions.
 */
export default async function BudgetPacingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; granularity?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.month && MONTH.test(sp.month) ? sp.month : monthKey(today);
  const granularity: Granularity =
    sp.granularity && (GRANULARITIES as string[]).includes(sp.granularity)
      ? (sp.granularity as Granularity)
      : "daily";

  // Ads and store data are uploaded separately, so each side is gated by its
  // OWN horizon — otherwise a brand with orders but no ad exports (or the
  // reverse) sees an all-dashes page despite having real data.
  const [data, series, history, horizon, storeHorizon] = await Promise.all([
    getBudgetMonth(month),
    budgetPacingSeries(month),
    budgetHistory(),
    dataHorizon(),
    storeDataHorizon(),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Pacing"
        subtitle="Plan vs actual — where the month's money landed by platform and objective, and how spend and revenue track the plan curve over time."
      />
      <BudgetPacing
        month={month}
        today={today}
        granularity={granularity}
        data={data}
        series={series}
        history={history}
        horizon={horizon}
        storeHorizon={storeHorizon}
      />
    </PageShell>
  );
}
