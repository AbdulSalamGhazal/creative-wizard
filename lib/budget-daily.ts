import {
  BUDGET_OBJECTIVES,
  TOTAL_SERIES_KEY,
  comboSeriesKey,
  isoDaysBetween,
  pacingDeviation,
  platformSeriesKey,
  resultFigures,
  round2,
  type BudgetObjective,
  type ResultFigures,
} from "@/lib/budget";
import type { RangeModel } from "@/lib/budget-range";

/**
 * DAY PACING (2026-11-14, the Budget restructure) — one day at a time: what
 * the plan gave that day against what was spent on it. Read off the range
 * model's per-day maps; nothing is queried or expanded here.
 *
 * A day is judged ONLY on the platforms that have reported it. The day's
 * expectation is `expectedPerDay` — each platform's plan through its own
 * covered day — so a platform that hasn't uploaded Nov 12 yet contributes
 * neither its plan nor a $0 to Nov 12 (`reporting` says how many did).
 *
 * In a CURVE month the day's plan is the curve's share of the month — nobody
 * typed it; in a day-by-day month it is the cell the sheet carried.
 */

export type DayState =
  /** Reported, with a plan to compare against. */
  | "judged"
  /** Reported, nothing planned that day (the actual is shown, no verdict). */
  | "no_plan"
  /** A past day no in-scope platform has uploaded yet — NOT zero. */
  | "not_reported"
  /** After today. */
  | "future";

export interface DayCell {
  date: string;
  state: DayState;
  /** The reporting platforms' plan for the day (the whole plan on a future day). */
  plan: number;
  /** Null when nothing is reported for the day. */
  actual: number | null;
  /** actual − plan (null unless judged). */
  delta: number | null;
  /** (actual − plan) ÷ plan (null unless judged). */
  deviation: number | null;
  /** How many in-scope platforms have reported the day, of how many. */
  reporting: number;
  platforms: number;
  /** Platform-reported results on the day (null = not reported / no day yet). */
  results: ResultFigures;
}

const at = (maps: Map<string, Map<string, number>>, key: string, date: string) =>
  maps.get(key)?.get(date);

function resultsAt(model: RangeModel, key: string, date: string, spend: number): ResultFigures {
  return resultFigures(
    spend,
    at(model.resultsPerDay.purchases, key, date) ?? null,
    at(model.resultsPerDay.value, key, date) ?? null,
  );
}

const NO_RESULTS: ResultFigures = { purchases: null, purchaseValue: null, roas: null, cpa: null };

/** One cell per day of the model's range. */
export function buildDayGrid(model: RangeModel, today: string): DayCell[] {
  const keys = model.platformKeys;
  return isoDaysBetween(model.from, model.to).map((date) => {
    const reporting = keys.filter((p) => {
      const through = model.throughByPlatform.get(p) ?? null;
      return through !== null && through >= date;
    }).length;
    const base = { date, reporting, platforms: keys.length };
    if (reporting === 0) {
      return {
        ...base,
        state: date > today ? ("future" as const) : ("not_reported" as const),
        plan: round2(at(model.planSpendPerDay, TOTAL_SERIES_KEY, date) ?? 0),
        actual: null,
        delta: null,
        deviation: null,
        results: NO_RESULTS,
      };
    }
    const plan = round2(at(model.expectedPerDay, TOTAL_SERIES_KEY, date) ?? 0);
    // The actual of the platforms that reported the day — a laggard's
    // not-yet-uploaded day is absent from the map, never a zero in the sum.
    const actual = round2(at(model.spendPerDay, TOTAL_SERIES_KEY, date) ?? 0);
    const results = resultsAt(model, TOTAL_SERIES_KEY, date, actual);
    if (plan <= 0) {
      return { ...base, state: "no_plan" as const, plan: 0, actual, delta: null, deviation: null, results };
    }
    return {
      ...base,
      state: "judged" as const,
      plan,
      actual,
      delta: round2(actual - plan),
      deviation: pacingDeviation(actual, plan),
      results,
    };
  });
}

export interface DayLine {
  plan: number;
  actual: number;
  delta: number;
  /** Null when nothing was planned that day. */
  deviation: number | null;
}

export interface DayPlatform extends DayLine {
  platform: string;
  /** False = this platform hasn't uploaded the day yet: no figures, no zero. */
  reported: boolean;
  buckets: Array<DayLine & { objective: BudgetObjective }>;
  results: ResultFigures;
}

export interface DayDetail {
  date: string;
  cell: DayCell;
  platforms: DayPlatform[];
  /** The range through this day: actual against each platform's own expectation. */
  toDate: { actual: number; expected: number; delta: number; deviation: number | null };
}

function line(plan: number, actual: number): DayLine {
  return {
    plan: round2(plan),
    actual: round2(actual),
    delta: round2(actual - plan),
    deviation: plan > 0 ? pacingDeviation(actual, plan) : null,
  };
}

/** Everything about ONE day: each platform, its buckets, and the range to date. */
export function buildDayDetail(model: RangeModel, date: string, today: string): DayDetail {
  const cell =
    buildDayGrid(model, today).find((c) => c.date === date) ??
    ({
      date,
      state: "future",
      plan: 0,
      actual: null,
      delta: null,
      deviation: null,
      reporting: 0,
      platforms: model.platformKeys.length,
      results: NO_RESULTS,
    } satisfies DayCell);

  const platforms: DayPlatform[] = model.platformKeys.map((p) => {
    const key = platformSeriesKey(p);
    const through = model.throughByPlatform.get(p) ?? null;
    const reported = through !== null && through >= date;
    const plan = at(model.planSpendPerDay, key, date) ?? 0;
    const actual = reported ? (at(model.spendPerDay, key, date) ?? 0) : 0;
    const buckets = BUDGET_OBJECTIVES.flatMap((objective) => {
      const combo = comboSeriesKey(p, objective);
      const bPlan = at(model.planSpendPerDay, combo, date) ?? 0;
      const bActual = reported ? (at(model.spendPerDay, combo, date) ?? 0) : 0;
      return bPlan > 0 || bActual > 0 ? [{ objective, ...line(bPlan, bActual) }] : [];
    });
    return {
      platform: p,
      reported,
      ...line(plan, actual),
      buckets,
      results: reported ? resultsAt(model, key, date, actual) : NO_RESULTS,
    };
  });

  let actualToDate = 0;
  let expectedToDate = 0;
  for (const iso of isoDaysBetween(model.from, date)) {
    actualToDate += at(model.spendPerDay, TOTAL_SERIES_KEY, iso) ?? 0;
    expectedToDate += at(model.expectedPerDay, TOTAL_SERIES_KEY, iso) ?? 0;
  }
  return {
    date,
    cell,
    platforms: platforms.filter((p) => p.plan > 0 || p.actual > 0 || !p.reported),
    toDate: {
      actual: round2(actualToDate),
      expected: round2(expectedToDate),
      delta: round2(actualToDate - expectedToDate),
      deviation: expectedToDate > 0 ? pacingDeviation(actualToDate, expectedToDate) : null,
    },
  };
}
