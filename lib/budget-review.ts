import {
  PACING_WARN_THRESHOLD,
  monthEndIso,
  monthKey,
  monthStartIso,
  pacingDeviation,
  round2,
  roasThroughRate,
  type PlatformCoverage,
} from "@/lib/budget";
import { buildRangeModel, type RangeState } from "@/lib/budget-range";
import type { BudgetPacingSeries, MonthPlanRow, MonthRevisionStats } from "@/db/queries/budget";

/**
 * MONTHS COMPARED (2026-11-14, the Budget restructure) — the manager's
 * question: how good were our plans? One row per month, each read off that
 * month's own range model (`buildRangeModel`), so a month here says exactly
 * what Today said about it.
 *
 * PLAN ACCURACY HAS TWO BASELINES, by the user's decision: the FINAL plan
 * (what the month ended up planned as) and the FIRST plan on record (the
 * original intent). A month revised on its last day scores perfectly against
 * its final plan — the gap between the two baselines is how far the plan was
 * moved to meet reality. Only CLOSED months are judged; the running month is
 * shown to date, without an accuracy.
 *
 * Revenue and ROAS are the STORE's (brand-wide; no platform attribution).
 */

export interface MonthReviewRow {
  /** YYYY-MM */
  month: string;
  state: RangeState;
  hasPlan: boolean;
  /** Final planned spend for the month (USD). */
  plan: number;
  /** The first plan on record (null = none recorded). */
  firstPlan: number | null;
  /** The first plan's revenue target, SAR (null = none recorded, or it set none). */
  firstRevenueTarget: number | null;
  /** When the first plan was saved (ISO timestamp; null = none recorded). */
  firstPlanAt: string | null;
  /** Actual spend — the whole month once closed, to date while it runs. */
  actual: number;
  /** actual vs the final plan, as a deviation (closed months only). */
  vsPlan: number | null;
  /** actual vs the first plan (closed months with a first plan only). */
  vsFirst: number | null;
  /** While the month runs: actual vs what the plan expected through coverage. */
  paceToDate: number | null;
  revenue: number;
  revenueTarget: number;
  /** revenue vs target (closed months with a target only). */
  vsRevenue: number | null;
  roas: number | null;
  roasTarget: number | null;
  reserve: number;
  reserveUsed: number;
  /** How many times the month's plan was saved. */
  revisions: number;
}

export interface ReviewSummary {
  /** Closed months that had a plan. */
  closed: number;
  /** …of which landed within the on-track threshold of the final plan. */
  onPlan: number;
  /** Σ actual ÷ Σ final plan − 1 over those months. */
  vsPlan: number | null;
  /** Σ actual ÷ Σ first plan − 1 over the closed months that recorded one. */
  vsFirst: number | null;
  /** Σ revenue ÷ Σ target − 1 over closed months with a target. */
  vsRevenue: number | null;
}

export function buildMonthReview(input: {
  /** Oldest first. */
  months: readonly string[];
  /** The Pacing scan over the months' whole span. */
  series: BudgetPacingSeries;
  plans: readonly MonthPlanRow[];
  stats: readonly MonthRevisionStats[];
  rate: number;
  coverage: PlatformCoverage;
  storeHorizon: string | null;
  today: string;
}): { rows: MonthReviewRow[]; summary: ReviewSummary } {
  const thisMonth = monthKey(input.today);
  const rows = input.months.map((month): MonthReviewRow => {
    const from = monthStartIso(month);
    const to = monthEndIso(month);
    const inMonth = (date: string) => date >= from && date <= to;
    const plan = input.plans.find((p) => p.month === month);
    const model = buildRangeModel({
      from,
      to,
      series: {
        spend: input.series.spend.filter((r) => inMonth(r.date)),
        days: input.series.days.filter((d) => inMonth(d.date)),
      },
      plans: plan ? [plan] : [],
      rate: input.rate,
      platforms: [],
      coverage: input.coverage,
      storeHorizon: input.storeHorizon,
      today: input.today,
    });
    const { spend, revenue, roas } = model.card;
    const stat = input.stats.find((s) => s.month === month);
    // The month's clock is the CALENDAR's here: a past month with no spend
    // and no plan has no covered day, and would otherwise read "not started".
    const state: RangeState =
      month < thisMonth ? "final" : month > thisMonth ? "future" : spend.state === "final" ? "final" : "live";
    const closed = state === "final";
    const hasPlan = !!plan && (plan.allocations.length > 0 || plan.reserveSpendUsd > 0);
    const firstPlan = stat?.first ? round2(stat.first.plannedTotal) : null;
    // A closed month's ROAS is the whole month's; the model's card cuts both
    // sides at the same day, which for a closed month is its end.
    // No store revenue recorded is "unknown", not a 0.00× month.
    const roasActual =
      revenue.bar.actual <= 0
        ? null
        : closed
          ? roasThroughRate(revenue.bar.actual, spend.bar.actual, input.rate)
          : roas.actual;
    return {
      month,
      state,
      hasPlan,
      plan: spend.bar.plan,
      firstPlan,
      firstRevenueTarget: stat?.first?.plannedRevenueSar ?? null,
      firstPlanAt: stat?.first?.createdAt ?? null,
      actual: spend.bar.actual,
      vsPlan: closed && spend.bar.plan > 0 ? pacingDeviation(spend.bar.actual, spend.bar.plan) : null,
      vsFirst:
        closed && firstPlan !== null && firstPlan > 0
          ? pacingDeviation(spend.bar.actual, firstPlan)
          : null,
      paceToDate: state === "live" ? spend.bar.deviation : null,
      revenue: revenue.bar.actual,
      revenueTarget: revenue.bar.plan,
      vsRevenue:
        closed && revenue.bar.plan > 0 ? pacingDeviation(revenue.bar.actual, revenue.bar.plan) : null,
      roas: roasActual,
      roasTarget: revenue.bar.plan > 0 && spend.bar.plan > 0 ? roas.target : null,
      reserve: plan?.reserveSpendUsd ?? 0,
      reserveUsed: model.reserve.kind === "month" ? model.reserve.used : 0,
      revisions: stat?.count ?? 0,
    };
  });

  const judged = rows.filter((r) => r.state === "final" && r.plan > 0);
  const sum = (list: readonly MonthReviewRow[], pick: (r: MonthReviewRow) => number) =>
    list.reduce((s, r) => s + pick(r), 0);
  const ratio = (actual: number, base: number) => (base > 0 ? pacingDeviation(actual, base) : null);
  const withFirst = judged.filter((r) => r.firstPlan !== null && r.firstPlan > 0);
  const withTarget = rows.filter((r) => r.state === "final" && r.revenueTarget > 0);
  return {
    rows,
    summary: {
      closed: judged.length,
      onPlan: judged.filter((r) => Math.abs(r.vsPlan ?? 0) < PACING_WARN_THRESHOLD).length,
      vsPlan: ratio(sum(judged, (r) => r.actual), sum(judged, (r) => r.plan)),
      vsFirst: ratio(sum(withFirst, (r) => r.actual), sum(withFirst, (r) => r.firstPlan ?? 0)),
      vsRevenue: ratio(sum(withTarget, (r) => r.revenue), sum(withTarget, (r) => r.revenueTarget)),
    },
  };
}
