import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import { monthEndIso, monthKey, monthStartIso, prevMonthKey } from "@/lib/budget";
import { buildMonthReview } from "@/lib/budget-review";
import { REVIEW_SPANS, REVIEW_VIEWS, type ReviewSpan, type ReviewView } from "@/validators/budget";
import {
  budgetPacingSeries,
  budgetPlansForMonths,
  getUsdToSarRate,
  listPlanRevisionLog,
  planRevisionStats,
} from "@/db/queries/budget";
import { platformHorizons, storeDataHorizon } from "@/db/queries/series-bounds";
import { resolveFilterPrefs } from "@/db/queries/user-prefs";
import { BudgetReview } from "@/components/budget/budget-review";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget · Review" };

/**
 * Budget → Review (2026-11-14, the restructure): the manager's page — the
 * last 6, 12 or 24 months compared. For each closed month: spend against the
 * plan it ended with AND the first plan saved for it, revenue and ROAS
 * against their targets, the reserve drawn, how often the plan changed; and
 * the log of who changed it.
 *
 * ONE Pacing scan over the whole span (the same raw read every Budget page
 * makes), the plans for those months, and two small revision reads. Each
 * month's figures are that month's own range model, so a month here says what
 * Today said about it. Open to any brand member, like the other read pages.
 */
export default async function BudgetReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string; reviewview?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();
  const span: ReviewSpan = (REVIEW_SPANS as readonly string[]).includes(sp.months ?? "")
    ? (sp.months as ReviewSpan)
    : "12";

  const months: string[] = [];
  let cursor = monthKey(today);
  for (let i = 0; i < Number(span); i++) {
    months.unshift(cursor);
    cursor = prevMonthKey(cursor);
  }
  const from = monthStartIso(months[0]!);
  const to = monthEndIso(months.at(-1)!);

  const raw = sp as Record<string, string | undefined>;
  const pref = await resolveFilterPrefs(
    [{ key: "reviewview", allow: REVIEW_VIEWS }],
    (key) => (key === "reviewview" ? raw.reviewview : undefined),
  );
  const view: ReviewView = (REVIEW_VIEWS as readonly string[]).includes(pref.reviewview ?? "")
    ? (pref.reviewview as ReviewView)
    : "scorecard";

  const [series, plans, rate, coverage, storeHorizon, stats, log, user] = await Promise.all([
    budgetPacingSeries(from, to),
    budgetPlansForMonths(months),
    getUsdToSarRate(),
    platformHorizons(),
    storeDataHorizon(),
    planRevisionStats(months),
    listPlanRevisionLog(months),
    auth(),
  ]);
  const { rows, summary } = buildMonthReview({
    months,
    series,
    plans,
    stats,
    rate,
    coverage,
    storeHorizon,
    today,
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Review"
        info="Closed months are judged against their plan; the running month is shown to date. Spend is raw; revenue and ROAS are the store's."
      />
      <BudgetReview
        rows={rows}
        summary={summary}
        log={log}
        rate={rate}
        span={span}
        view={view}
        canManage={user ? can(user, "budget.manage") : false}
      />
    </PageShell>
  );
}
