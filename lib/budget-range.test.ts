import { describe, expect, it } from "vitest";
import { isoDaysBetween } from "@/lib/budget";
import { buildRangeModel } from "@/lib/budget-range";
import type { MonthPlanRow } from "@/db/queries/budget";

const FROM = "2026-10-01";
const TO = "2026-10-31";
const RATE = 3.75;

/** $100/day per planned platform ($3,100 each), linear curve. */
function plan(platforms: string[], over: Partial<MonthPlanRow> = {}): MonthPlanRow {
  return {
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
    ...over,
  };
}
const spend = (platform: string, through: string, perDay = 100) =>
  isoDaysBetween(FROM, through).map((date) => ({
    date,
    platform,
    objective: "Awareness" as const,
    spend: perDay,
    purchases: null,
    purchaseValue: null,
  }));
const revenue = (through: string, perDay: number) =>
  isoDaysBetween(FROM, TO).map((date) => ({
    date,
    revenueSar: date <= through ? perDay : 0,
    orders: date <= through ? 1 : 0,
  }));

function model(over: Partial<Parameters<typeof buildRangeModel>[0]>) {
  return buildRangeModel({
    from: FROM,
    to: TO,
    series: { spend: [], days: revenue(TO, 0) },
    plans: [plan(["instagram"])],
    rate: RATE,
    platforms: [],
    coverage: {},
    storeHorizon: null,
    today: "2026-10-23",
    ...over,
  });
}

describe("buildRangeModel — the one model every Budget page reads", () => {
  it("each platform is judged through ITS OWN day; the total is the sum of those expectations", () => {
    const m = model({
      series: {
        spend: [...spend("instagram", "2026-10-22"), ...spend("tiktok", "2026-10-15")],
        days: revenue(TO, 0),
      },
      plans: [plan(["instagram", "tiktok"])],
      coverage: { instagram: "2026-10-22", tiktok: "2026-10-15" },
    });
    // On plan through each one's own day: 2,200 + 1,500, never 4,400.
    expect(m.card.spend.bar.planToDate).toBe(3700);
    expect(m.card.spend.bar.actual).toBe(3700);
    expect(m.card.spend.bar.deviation).toBe(0);
    expect(m.card.spend.state).toBe("live");
    expect(m.card.spend.projected).toBe(6200);
    expect(m.throughByPlatform.get("tiktok")).toBe("2026-10-15");
    expect(m.spendThrough).toBe("2026-10-22");
  });

  it("a month before today's is FINAL: covered to its end, no projection", () => {
    const m = model({
      series: { spend: spend("instagram", "2026-10-25"), days: revenue(TO, 0) },
      coverage: { instagram: "2026-10-25" },
      today: "2026-11-05",
    });
    expect(m.card.spend.state).toBe("final");
    expect(m.card.spend.through).toBe(TO);
    // …but the words name the day the data really reaches.
    expect(m.card.spend.lastData).toBe("2026-10-25");
    expect(m.card.spend.projected).toBeNull();
    expect(m.card.spend.bar.planToDate).toBe(3100);
  });

  it("revenue paces against the STORE's own day; ROAS cuts both sides at the earlier one", () => {
    const m = model({
      series: { spend: spend("instagram", "2026-10-22"), days: revenue("2026-10-15", 750) },
      plans: [plan(["instagram"], { plannedRevenueSar: 23_250 })],
      coverage: { instagram: "2026-10-22" },
      storeHorizon: "2026-10-15",
    });
    // 750 SAR a day for 15 days against 23,250 / 31 = 750 a day: on target.
    expect(m.card.revenue.through).toBe("2026-10-15");
    expect(m.card.revenue.bar.actual).toBe(11_250);
    expect(m.card.revenue.bar.planToDate).toBeCloseTo(11_250, 6);
    // ROAS: 11,250 SAR over (1,500 USD × 3.75) — both through the 15th.
    expect(m.roasThrough).toBe("2026-10-15");
    expect(m.card.roas.actual).toBeCloseTo(2, 6);
    expect(m.card.roas.target).toBeCloseTo(2, 6);
  });

  it("a future month has a plan to show and nothing to judge", () => {
    const m = model({ today: "2026-09-10" });
    expect(m.card.spend.state).toBe("future");
    expect(m.card.spend.bar.plan).toBe(3100);
    expect(m.card.spend.bar.deviation).toBeNull();
  });

  it("the reserve is the month's: drawn by spend beyond a platform's plan; a reserve-only month is a plan", () => {
    const hot = model({
      series: { spend: spend("instagram", "2026-10-20", 180), days: revenue(TO, 0) },
      plans: [plan(["instagram"], { reserveSpendUsd: 1000 })],
      coverage: { instagram: "2026-10-20" },
    });
    // 3,600 spent against 3,100 planned.
    expect(hot.reserve).toEqual({ kind: "month", used: 500, reserve: 1000 });
    const reserveOnly = model({ plans: [plan([], { reserveSpendUsd: 500 })] });
    expect(reserveOnly.reserve).toEqual({ kind: "month", used: 0, reserve: 500 });
    expect(model({ plans: [plan([])] }).reserve).toEqual({ kind: "none" });
  });

  it("a daily month's ROAS target is its stored one (revenue = spend × ROAS × rate)", () => {
    const planDays = isoDaysBetween(FROM, TO).map((_, i) => ({
      day: i + 1,
      platform: "instagram",
      objective: "Awareness" as const,
      plannedSpend: 100,
    }));
    const m = model({
      series: { spend: spend("instagram", "2026-10-22"), days: revenue("2026-10-22", 1125) },
      plans: [plan(["instagram"], { planMode: "daily", planDays, targetRoas: 3 })],
      coverage: { instagram: "2026-10-22" },
      storeHorizon: "2026-10-22",
    });
    expect(m.card.roas.target).toBeCloseTo(3, 6);
    expect(m.card.roas.actual).toBeCloseTo(3, 6);
  });

  it("a platform filter scopes plan, actual and coverage together", () => {
    const m = model({
      series: {
        spend: [...spend("instagram", "2026-10-22"), ...spend("tiktok", "2026-10-15")],
        days: revenue(TO, 0),
      },
      plans: [plan(["instagram", "tiktok"])],
      coverage: { instagram: "2026-10-22", tiktok: "2026-10-15" },
      platforms: ["tiktok"],
    });
    expect(m.platformKeys).toEqual(["tiktok"]);
    expect(m.card.spend.bar.plan).toBe(3100);
    expect(m.card.spend.bar.actual).toBe(1500);
    expect(m.spendThrough).toBe("2026-10-15");
  });
});
