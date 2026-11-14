import { auth, can } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthEndIso, monthStartIso } from "@/lib/budget";
// Month 01-12 only — `2026-13` must fall back to the current month, not
// produce a nonsense one. One regex, in the validators.
import {
  PACING_BOARDS,
  PACING_GROUPS,
  PACING_RANKS,
  pacingViewSchema,
  resolveBudgetMonth,
} from "@/validators/budget";
import {
  budgetPacingSeries,
  budgetPlansForMonths,
  getUsdToSarRate,
  plannedMonths,
} from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { resolveFilterPrefs } from "@/db/queries/user-prefs";
import { BudgetToday } from "@/components/budget/budget-today";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget · Today" };

/**
 * Budget → Today (2026-11-14, the restructure; it replaced the Overview): the
 * month for the person spending it — three cards (spend · revenue · ROAS
 * against plan, with where each lands), what needs a decision, each
 * platform's last reported day, and the pace board. Actuals are RAW (no
 * exclusion filtering — standing decision, see db/queries/budget.ts). Viewing
 * is open to any signed-in brand member; editing is behind budget.manage.
 *
 * The same reads Analysis makes for a range, over one month: the Pacing scan
 * and the month's plan — every number on the page is `buildRangeModel`.
 */
export default async function BudgetTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const month = resolveBudgetMonth(sp.month, today);

  // The board's three view controls are remembered per user per brand, under
  // the keys Analysis uses — a choice made on one page carries to the other.
  // Today never puts them in the URL, so only the saved value is read.
  const pref = await resolveFilterPrefs(
    [
      { key: "board", allow: PACING_BOARDS },
      { key: "rank", allow: PACING_RANKS },
      { key: "group", allow: PACING_GROUPS },
    ],
    () => undefined,
  );
  const view = pacingViewSchema.parse({ board: pref.board, rank: pref.rank, group: pref.group });

  // PER-PLATFORM coverage, not one overall horizon: every pacing comparison
  // anchors each platform to the days its data actually covers.
  const [series, plans, rate, platformCoverage, storeHorizon, months, user] = await Promise.all([
    budgetPacingSeries(monthStartIso(month), monthEndIso(month)),
    budgetPlansForMonths([month]),
    getUsdToSarRate(),
    platformHorizons(),
    storeDataHorizon(),
    // One cheap month-grain query, for the rollover nudge on an empty month.
    plannedMonths(),
    auth(),
  ]);
  const canManage = user ? can(user, "budget.manage") : false;
  // Pinned to the brand this page rendered under: a brand switched in
  // another tab must not receive a move made from this one.
  const brand = await getActiveAccountId();
  const seedMonth = months.find((m) => m < month) ?? null;

  return (
    <PageShell>
      {/* Anchored to the month in view: a comment on September stays on
          September when you step to October. */}
      <CommentAnchor type="budget_month" id={month} />
      <PageHeader
        eyebrow="Budget"
        title="Today"
        info="Actuals are raw totals (exclusions don't apply here). Each platform is judged through its own last uploaded day."
      />
      <BudgetToday
        month={month}
        today={today}
        series={series}
        plans={plans}
        rate={rate}
        coverage={platformCoverage}
        storeHorizon={storeHorizon}
        seedMonth={seedMonth}
        canManage={canManage}
        view={{ board: view.board, rank: view.rank, group: view.group }}
        brand={brand}
      />
    </PageShell>
  );
}
