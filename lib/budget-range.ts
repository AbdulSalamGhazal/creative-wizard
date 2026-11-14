import { ALL_PLATFORMS } from "@/lib/palette";

type PlatformKey = (typeof ALL_PLATFORMS)[number];
import {
  TOTAL_SERIES_KEY,
  buildPlanSeries,
  buildPlanSpendPerDay,
  buildRangeBoard,
  buildResultsPerDay,
  buildSpendPerDay,
  coveredThrough,
  expectedPlanPerDay,
  isoDaysBetween,
  lastDataIn,
  latestCoverage,
  pacingDeviation,
  reserveUsed,
  roasThroughOf,
  roasThroughRate,
  round2,
  stitchPlanByDay,
  type PerDayMaps,
  type PlanSeries,
  type PlatformCoverage,
  type RangeBoard,
  type ResultsPerDay,
  type TrackerBar,
} from "@/lib/budget";
import type { BudgetPacingSeries, MonthPlanRow } from "@/db/queries/budget";

/**
 * THE RANGE MODEL (2026-11-14, the Budget restructure) — everything a Budget
 * page derives from one range of actuals and the plans it touches, built ONCE
 * and read by every surface: Today (a month), Daily (a month, per day),
 * Analysis (any range) and the MCP. It replaces the month-only
 * `buildTrackerRows` and the math that used to live in the Pacing component's
 * render, so a number on one page can never be a second derivation of the
 * same number on another.
 *
 * The rules are the module's, unchanged: actuals are RAW; each platform is
 * judged through its OWN covered day and a total is the SUM of its rows'
 * expectations; revenue has no platform attribution, so ROAS cuts both sides
 * at the earliest of the store's and every reporting platform's day.
 */

export type RangeState = "future" | "live" | "final";

export interface RangeSide {
  state: RangeState;
  /** The last covered day inside the range (null = none yet). */
  through: string | null;
  /** The day the data REALLY reaches (≤ `through`; earlier in a month that is over). */
  lastData: string | null;
  bar: TrackerBar;
  projected: number | null;
  /**
   * Months in the range with actuals but NO plan on this side, and what was
   * spent (or earned) in them through coverage. A range like Apr–Sep with one
   * planned month has a plan to show but no pace to judge, so the card says
   * this instead of a verdict.
   */
  unplanned: { months: number; amount: number };
}

export interface RangeCardData {
  spend: RangeSide;
  revenue: RangeSide;
  roas: {
    state: RangeState;
    through: string | null;
    lastData: string | null;
    actual: number | null;
    /** The on-plan ROAS to date (over the whole range before it starts). */
    target: number | null;
    projected: number | null;
  };
}

export type RangeReserve =
  | { kind: "none" }
  | { kind: "month"; used: number; reserve: number };

export interface RangeModelInput {
  from: string;
  to: string;
  series: BudgetPacingSeries;
  plans: MonthPlanRow[];
  rate: number;
  /** Empty = every platform. */
  platforms: readonly string[];
  coverage: PlatformCoverage;
  storeHorizon: string | null;
  today: string;
}

export interface RangeModel {
  from: string;
  to: string;
  /** In scope, with a plan or any spend in the range — `ALL_PLATFORMS` order. */
  platformKeys: PlatformKey[];
  monthSeries: PlanSeries[];
  spendPerDay: PerDayMaps;
  resultsPerDay: ResultsPerDay;
  revenuePerDay: Map<string, number>;
  planSpendPerDay: PerDayMaps;
  planRevenuePerDay: Map<string, number>;
  /** Each platform's plan through ITS OWN covered day; totals re-summed. */
  expectedPerDay: PerDayMaps;
  throughByPlatform: Map<string, string | null>;
  /** The spend side's "data through": the latest any in-scope platform covers. */
  spendThrough: string | null;
  revenueThrough: string | null;
  roasThrough: string | null;
  /** What a footnote prints: the in-scope platforms' raw last upload. */
  horizon: string | null;
  board: RangeBoard;
  card: RangeCardData;
  reserve: RangeReserve;
  /** The month the range sits inside, when it sits inside ONE. */
  singleMonth: string | null;
  /** …and that month's plan row, if any. */
  monthPlan: MonthPlanRow | undefined;
}

function sumThrough(
  map: Map<string, number> | undefined,
  from: string,
  through: string | null,
): number {
  if (!map || !through) return 0;
  let total = 0;
  for (const iso of isoDaysBetween(from, through)) total += map.get(iso) ?? 0;
  return total;
}

export function buildRangeModel(input: RangeModelInput): RangeModel {
  const { from, to, series, plans, rate, platforms, coverage, storeHorizon, today } = input;
  const inScope = (platform: string) => platforms.length === 0 || platforms.includes(platform);

  const seen = new Set<string>();
  for (const r of series.spend) seen.add(r.platform);
  for (const p of plans) for (const a of p.allocations) seen.add(a.platform);
  const platformKeys = ALL_PLATFORMS.filter((p) => inScope(p) && seen.has(p));

  const spendPerDay = buildSpendPerDay(series.spend, inScope);
  const resultsPerDay = buildResultsPerDay(series.spend, inScope);
  const revenuePerDay = new Map<string, number>();
  for (const d of series.days) revenuePerDay.set(d.date, d.revenueSar);

  const monthSeries = plans.map((p) =>
    buildPlanSeries({
      month: p.month,
      planMode: p.planMode,
      allocations: p.allocations,
      plannedRevenueSar: p.plannedRevenueSar,
      dayWeights: p.dayWeights,
      planDays: p.planDays,
      targetRoas: p.targetRoas,
      usdToSarRate: rate,
    }),
  );
  const planSpendPerDay = buildPlanSpendPerDay(monthSeries, platformKeys, inScope);
  const planRevenuePerDay = stitchPlanByDay(monthSeries, (m) => m.revenueDays());

  const throughByPlatform = new Map<string, string | null>(
    platformKeys.map((p) => [p, coveredThrough(coverage[p], from, to, today)]),
  );
  const spendThrough = latestCoverage(Object.fromEntries(throughByPlatform));
  const revenueThrough = coveredThrough(storeHorizon, from, to, today);
  const roasThrough = roasThroughOf(
    revenueThrough,
    platformKeys.map((p) => throughByPlatform.get(p) ?? null),
  );
  const horizon = latestCoverage(
    Object.fromEntries(ALL_PLATFORMS.filter(inScope).map((p) => [p, coverage[p]])),
  );
  const expectedPerDay = expectedPlanPerDay(
    planSpendPerDay,
    platformKeys,
    (p) => throughByPlatform.get(p) ?? null,
  );

  const board = buildRangeBoard({
    from,
    to,
    spendPerDay,
    planSpendPerDay,
    resultsPerDay,
    platforms: platformKeys,
    coverage,
    today,
  });

  // ── The cards ──────────────────────────────────────────────────────────────
  const roasOf = (revenueSar: number, spendUsd: number) =>
    roasThroughRate(revenueSar, spendUsd, rate);
  const stateOf = (through: string | null): RangeState =>
    through === null ? "future" : through >= to ? "final" : "live";
  const bar = (
    key: string,
    label: string,
    plan: number,
    actual: number,
    expected: number,
  ): TrackerBar => ({
    key,
    label,
    plan,
    actual,
    planToDate: expected,
    delta: round2(actual - expected),
    deviation: pacingDeviation(actual, expected),
  });
  // actual ÷ (expected ÷ plan): the coverage-fraction projection, only while
  // the range is still running.
  const project = (plan: number, actual: number, expected: number, state: RangeState) =>
    state === "live" && plan > 0 && expected > 0 ? round2((actual * plan) / expected) : null;
  const unplannedIn = (
    actualMap: Map<string, number> | undefined,
    through: string | null,
    planned: (month: string) => boolean,
  ) => {
    const byMonth = new Map<string, number>();
    if (actualMap && through) {
      for (const iso of isoDaysBetween(from, through)) {
        const v = actualMap.get(iso) ?? 0;
        if (v > 0) byMonth.set(iso.slice(0, 7), (byMonth.get(iso.slice(0, 7)) ?? 0) + v);
      }
    }
    let months = 0;
    let amount = 0;
    for (const [month, v] of byMonth) {
      if (planned(month)) continue;
      months += 1;
      amount += v;
    }
    return { months, amount: round2(amount) };
  };
  const spendPlanned = (month: string) =>
    plans.some((p) => p.month === month && p.allocations.length > 0);
  const revenuePlanned = (month: string) =>
    plans.some((p) => p.month === month && (p.plannedRevenueSar !== null || p.targetRoas !== null));

  // The board's rows, summed. FINAL only once every planned platform is
  // covered to the range's end (a past month always is).
  const rows = board.platforms;
  const judged = rows.some((p) => p.plan > 0) ? rows.filter((p) => p.plan > 0) : rows;
  const spendPlan = round2(rows.reduce((a, p) => a + p.plan, 0));
  const spendActual = round2(rows.reduce((a, p) => a + p.actual, 0));
  const spendExpected = round2(rows.reduce((a, p) => a + p.planToDate, 0));
  const spendState: RangeState =
    spendThrough === null
      ? "future"
      : judged.length > 0 && judged.every((p) => p.through !== null && p.through >= to)
        ? "final"
        : "live";
  const spendUnplanned = unplannedIn(
    spendPerDay.get(TOTAL_SERIES_KEY),
    spendThrough,
    spendPlanned,
  );
  const spend: RangeSide = {
    state: spendState,
    through: spendThrough,
    lastData: lastDataIn(horizon, spendThrough),
    bar: bar("spend", "Spend", spendPlan, spendActual, spendExpected),
    projected:
      spendUnplanned.months > 0 ? null : project(spendPlan, spendActual, spendExpected, spendState),
    unplanned: spendUnplanned,
  };

  const revenuePlan = sumThrough(planRevenuePerDay, from, to);
  const revenueActual = sumThrough(revenuePerDay, from, revenueThrough);
  const revenueExpected = sumThrough(planRevenuePerDay, from, revenueThrough);
  const revenueState = stateOf(revenueThrough);
  const revenueUnplanned = unplannedIn(revenuePerDay, revenueThrough, revenuePlanned);
  const revenue: RangeSide = {
    state: revenueState,
    through: revenueThrough,
    lastData: lastDataIn(storeHorizon, revenueThrough),
    bar: bar("revenue", "Revenue", revenuePlan, revenueActual, revenueExpected),
    projected:
      revenueUnplanned.months > 0
        ? null
        : project(revenuePlan, revenueActual, revenueExpected, revenueState),
    unplanned: revenueUnplanned,
  };

  const roasState = stateOf(roasThrough);
  const roasActual = roasOf(
    sumThrough(revenuePerDay, from, roasThrough),
    sumThrough(spendPerDay.get(TOTAL_SERIES_KEY), from, roasThrough),
  );
  const roasTarget = roasOf(
    sumThrough(planRevenuePerDay, from, roasThrough),
    sumThrough(planSpendPerDay.get(TOTAL_SERIES_KEY), from, roasThrough),
  );
  const roasRangeTarget = roasOf(revenuePlan, spendPlan);
  const roasProjected =
    roasState === "live" && spend.projected !== null && revenue.projected !== null
      ? roasOf(revenue.projected, spend.projected)
      : null;

  const card: RangeCardData = {
    spend,
    revenue,
    roas: {
      state: roasState,
      through: roasThrough,
      lastData: lastDataIn(
        roasThroughOf(storeHorizon, platformKeys.map((p) => coverage[p] ?? null)),
        roasThrough,
      ),
      actual: roasActual,
      target: roasTarget ?? roasRangeTarget,
      projected: roasProjected,
    },
  };

  // The reserve is a MONTH's figure (the platform-level rule, `reserveUsed`):
  // read when the range sits inside one planned month. A reserve-only month
  // IS a plan (W1-13).
  const singleMonth = from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : null;
  const monthPlan = singleMonth ? plans.find((p) => p.month === singleMonth) : undefined;
  const reserve: RangeReserve =
    monthPlan && (monthPlan.allocations.length > 0 || monthPlan.reserveSpendUsd > 0)
      ? {
          kind: "month",
          used: reserveUsed(
            monthPlan.allocations,
            board.platforms.map((p) => ({ platform: p.key, actualSpend: p.actual })),
          ),
          reserve: monthPlan.reserveSpendUsd,
        }
      : { kind: "none" };

  return {
    from,
    to,
    platformKeys,
    monthSeries,
    spendPerDay,
    resultsPerDay,
    revenuePerDay,
    planSpendPerDay,
    planRevenuePerDay,
    expectedPerDay,
    throughByPlatform,
    spendThrough,
    revenueThrough,
    roasThrough,
    horizon,
    board,
    card,
    reserve,
    singleMonth,
    monthPlan,
  };
}
