import { describe, expect, it } from "vitest";
import { isoDaysBetween } from "@/lib/budget";
import { buildRangeModel } from "@/lib/budget-range";
import { buildDayDetail, buildDayGrid } from "@/lib/budget-daily";
import type { MonthPlanRow } from "@/db/queries/budget";

const FROM = "2026-10-01";
const TO = "2026-10-31";
const TODAY = "2026-10-23";

/** $100/day per planned platform × objective, linear curve. */
const plan = (platforms: string[]): MonthPlanRow => ({
  month: "2026-10",
  allocations: platforms.map((platform) => ({
    platform,
    objective: "Awareness",
    plannedSpend: 3100,
  })),
  plannedRevenueSar: null,
  reserveSpendUsd: 0,
  dayWeights: {},
  planMode: "curve",
  planDays: [],
  targetRoas: null,
});
const spend = (platform: string, through: string, perDay: (date: string) => number) =>
  isoDaysBetween(FROM, through).map((date) => ({
    date,
    platform,
    objective: "Awareness" as const,
    spend: perDay(date),
    purchases: 4 as number | null,
    purchaseValue: 300 as number | null,
  }));

const model = buildRangeModel({
  from: FROM,
  to: TO,
  series: {
    spend: [
      // Instagram: on plan, except the 10th (a $250 day).
      ...spend("instagram", "2026-10-22", (d) => (d === "2026-10-10" ? 250 : 100)),
      // TikTok: $60 a day, and its upload stops on the 15th.
      ...spend("tiktok", "2026-10-15", () => 60),
    ],
    days: [],
  },
  plans: [plan(["instagram", "tiktok"])],
  rate: 3.75,
  platforms: [],
  coverage: { instagram: "2026-10-22", tiktok: "2026-10-15" },
  storeHorizon: null,
  today: TODAY,
});
const grid = buildDayGrid(model, TODAY);
const cell = (date: string) => grid.find((c) => c.date === date)!;

describe("buildDayGrid — one day against that day's plan", () => {
  it("has a cell for every day of the month", () => {
    expect(grid).toHaveLength(31);
  });

  it("a day both platforms reported is judged on both", () => {
    // 250 + 60 against 100 + 100.
    expect(cell("2026-10-10")).toMatchObject({
      state: "judged",
      plan: 200,
      actual: 310,
      delta: 110,
      reporting: 2,
      platforms: 2,
    });
    expect(cell("2026-10-10").deviation).toBeCloseTo(0.55, 6);
  });

  it("a day a laggard hasn't uploaded is judged on the platforms that did — never a $0 for the other", () => {
    // The 20th: only Instagram reported. 100 against ITS 100, not against 200.
    expect(cell("2026-10-20")).toMatchObject({
      state: "judged",
      plan: 100,
      actual: 100,
      delta: 0,
      reporting: 1,
    });
  });

  it("a past day nobody uploaded is NOT REPORTED, a day after today is FUTURE — neither is zero", () => {
    expect(cell("2026-10-23")).toMatchObject({ state: "not_reported", actual: null, delta: null });
    expect(cell("2026-10-28")).toMatchObject({ state: "future", actual: null, plan: 200 });
  });

  it("carries the platforms' own results for the day", () => {
    // 8 purchases worth $600 on $310.
    expect(cell("2026-10-10").results.purchases).toBe(8);
    expect(cell("2026-10-10").results.cpa).toBe(38.75);
  });
});

describe("buildDayDetail — the day, platform by platform", () => {
  it("names each platform's plan, spend and deviation, with its buckets", () => {
    const d = buildDayDetail(model, "2026-10-10", TODAY);
    const ig = d.platforms.find((p) => p.platform === "instagram")!;
    expect(ig).toMatchObject({ reported: true, plan: 100, actual: 250, delta: 150 });
    expect(ig.deviation).toBeCloseTo(1.5, 6);
    expect(ig.buckets).toEqual([
      { objective: "Awareness", plan: 100, actual: 250, delta: 150, deviation: 1.5 },
    ]);
    const tt = d.platforms.find((p) => p.platform === "tiktok")!;
    expect(tt).toMatchObject({ reported: true, plan: 100, actual: 60, delta: -40 });
  });

  it("a platform that hasn't uploaded the day is listed as not reported, with no figures", () => {
    const d = buildDayDetail(model, "2026-10-20", TODAY);
    const tt = d.platforms.find((p) => p.platform === "tiktok")!;
    expect(tt.reported).toBe(false);
    expect(tt.actual).toBe(0);
    expect(tt.results.purchases).toBeNull();
  });

  it("the range to date sums each platform through its own day", () => {
    const d = buildDayDetail(model, "2026-10-20", TODAY);
    // Instagram 20 days (one at 250) + TikTok 15 × 60; expected 2,000 + 1,500.
    expect(d.toDate).toMatchObject({ actual: 3050, expected: 3500, delta: -450 });
  });
});
