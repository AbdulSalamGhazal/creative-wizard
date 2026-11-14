import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { isValidIsoDate, monthEndIso, monthStartIso } from "@/lib/budget";
import { ALL_PLATFORMS } from "@/lib/palette";
import { DAILY_VIEWS, resolveBudgetMonth, type DailyView } from "@/validators/budget";
import { budgetPacingSeries, budgetPlansForMonths, getUsdToSarRate } from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { resolveFilterPrefs } from "@/db/queries/user-prefs";
import { BudgetDaily } from "@/components/budget/budget-daily";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget · Daily" };

/**
 * Budget → Daily (2026-11-14, the restructure): day pacing — any day of the
 * month against that day's plan, per platform and bucket, as a calendar, as
 * bars around zero, or as a table. The same two reads Today makes (the Pacing
 * scan and the month's plan); the day cells are `buildDayGrid` over
 * `buildRangeModel`. Actuals are RAW, and a day is judged only on the
 * platforms that have reported it.
 *
 * `?month=` and `?day=` are the shareable state; the platform filter and the
 * view are remembered per user per brand and change without a navigation.
 * (The path is /budget/days: /budget/daily was a permanent redirect for a
 * year, and browsers keep those.)
 */
export default async function BudgetDailyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string; platforms?: string; dayview?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  // A day link carries its own month.
  const dayParam = sp.day && isValidIsoDate(sp.day) ? sp.day : null;
  const month = resolveBudgetMonth(sp.month ?? dayParam?.slice(0, 7), today);
  const from = monthStartIso(month);
  const to = monthEndIso(month);

  const raw = sp as Record<string, string | undefined>;
  const pref = await resolveFilterPrefs(
    [
      { key: "platforms", allow: ALL_PLATFORMS },
      { key: "dayview", allow: DAILY_VIEWS },
    ],
    (key) => raw[key],
  );
  const platforms = (pref.platforms ?? "")
    .split(",")
    .filter((p) => (ALL_PLATFORMS as readonly string[]).includes(p));
  const view: DailyView = (DAILY_VIEWS as readonly string[]).includes(pref.dayview ?? "")
    ? (pref.dayview as DailyView)
    : "calendar";

  const [series, plans, rate, platformCoverage, storeHorizon] = await Promise.all([
    budgetPacingSeries(from, to),
    budgetPlansForMonths([month]),
    getUsdToSarRate(),
    platformHorizons(),
    storeDataHorizon(),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Daily"
        info="Actuals are raw totals (exclusions don't apply here). A day nobody has uploaded yet is not reported, never zero."
      />
      <BudgetDaily
        // A new month is a new page of days: the picked day must not carry over.
        key={month}
        month={month}
        today={today}
        series={series}
        plans={plans}
        rate={rate}
        coverage={platformCoverage}
        storeHorizon={storeHorizon}
        initialDay={dayParam && dayParam >= from && dayParam <= to ? dayParam : null}
        initialPlatforms={platforms}
        view={view}
      />
    </PageShell>
  );
}
