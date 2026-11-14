import { describe, expect, it } from "vitest";
import { isoDaysBetween } from "@/lib/budget";
import { buildMonthReview } from "@/lib/budget-review";
import type { MonthPlanRow } from "@/db/queries/budget";

const plan = (month: string, spend: number, over: Partial<MonthPlanRow> = {}): MonthPlanRow => ({
  month,
  allocations: [{ platform: "instagram", objective: "Awareness", plannedSpend: spend }],
  plannedRevenueSar: null,
  reserveSpendUsd: 0,
  dayWeights: {},
  planMode: "curve",
  planDays: [],
  targetRoas: null,
  ...over,
});
const spend = (from: string, to: string, perDay: number) =>
  isoDaysBetween(from, to).map((date) => ({
    date,
    platform: "instagram",
    objective: "Awareness" as const,
    spend: perDay,
    purchases: null,
    purchaseValue: null,
  }));
const days = (from: string, to: string, revenueSar: number) =>
  isoDaysBetween(from, to).map((date) => ({ date, revenueSar, orders: 1 }));

const review = buildMonthReview({
  months: ["2026-08", "2026-09", "2026-10"],
  series: {
    spend: [
      // August: 31 × 100 = 3,100 against a 3,100 plan that STARTED at 2,000.
      ...spend("2026-08-01", "2026-08-31", 100),
      // September: 30 × 140 = 4,200 against 3,000 — 40% over.
      ...spend("2026-09-01", "2026-09-30", 140),
      // October (running): on plan through the 20th.
      ...spend("2026-10-01", "2026-10-20", 100),
    ],
    days: [...days("2026-08-01", "2026-10-31", 375)],
  },
  plans: [
    plan("2026-08", 3100, { plannedRevenueSar: 11_625, reserveSpendUsd: 500 }),
    plan("2026-09", 3000),
    plan("2026-10", 3100),
  ],
  stats: [
    { month: "2026-08", count: 4, first: { plannedTotal: 2000, plannedRevenueSar: null, createdAt: "2026-07-28T00:00:00.000Z" } },
    { month: "2026-09", count: 1, first: { plannedTotal: 3000, plannedRevenueSar: null, createdAt: "2026-08-29T00:00:00.000Z" } },
    { month: "2026-10", count: 2, first: null },
  ],
  rate: 3.75,
  coverage: { instagram: "2026-10-20" },
  storeHorizon: "2026-10-20",
  today: "2026-10-21",
});
const row = (month: string) => review.rows.find((r) => r.month === month)!;

describe("buildMonthReview — how good were our plans", () => {
  it("a closed month is judged against BOTH baselines", () => {
    const aug = row("2026-08");
    expect(aug).toMatchObject({ state: "final", plan: 3100, firstPlan: 2000, actual: 3100, revisions: 4 });
    // Perfect against the plan it ended with…
    expect(aug.vsPlan).toBe(0);
    // …and 55% over the plan it started with.
    expect(aug.vsFirst).toBeCloseTo(0.55, 6);
    // Revenue 31 × 375 against 11,625: on target; ROAS = 11,625 ÷ (3,100 × 3.75) = 1.
    expect(aug.vsRevenue).toBe(0);
    expect(aug.roas).toBeCloseTo(1, 6);
    expect(aug.roasTarget).toBeCloseTo(1, 6);
  });

  it("a month over its plan says so, and draws nothing from a reserve it doesn't have", () => {
    const sep = row("2026-09");
    expect(sep.vsPlan).toBeCloseTo(0.4, 6);
    expect(sep.vsFirst).toBeCloseTo(0.4, 6);
    expect(sep.vsRevenue).toBeNull(); // no target
    expect(sep.reserve).toBe(0);
  });

  it("the running month is shown to date and NOT judged", () => {
    const oct = row("2026-10");
    expect(oct).toMatchObject({ state: "live", actual: 2000, vsPlan: null, vsFirst: null, firstPlan: null });
    expect(oct.paceToDate).toBe(0);
  });

  it("a past month with no spend and no plan is CLOSED, never 'not started'; no revenue is no ROAS", () => {
    const empty = buildMonthReview({
      months: ["2026-07", "2026-10", "2026-11"],
      series: { spend: spend("2026-07-01", "2026-07-02", 10), days: days("2026-07-01", "2026-07-31", 0) },
      plans: [],
      stats: [],
      rate: 3.75,
      coverage: { instagram: "2026-07-02" },
      storeHorizon: null,
      today: "2026-10-21",
    });
    expect(empty.rows.map((r) => r.state)).toEqual(["final", "live", "future"]);
    expect(empty.rows[0]!.roas).toBeNull();
    expect(empty.summary.closed).toBe(0);
  });

  it("the summary counts closed months only", () => {
    expect(review.summary.closed).toBe(2);
    expect(review.summary.onPlan).toBe(1);
    // 7,300 spent against 6,100 planned; against 5,000 first planned.
    expect(review.summary.vsPlan).toBeCloseTo(7300 / 6100 - 1, 6);
    expect(review.summary.vsFirst).toBeCloseTo(0.46, 6);
  });
});
