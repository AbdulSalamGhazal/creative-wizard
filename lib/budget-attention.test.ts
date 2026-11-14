import { describe, expect, it } from "vitest";
import { isoDaysBetween } from "@/lib/budget";
import { buildRangeModel } from "@/lib/budget-range";
import { buildAttention } from "@/lib/budget-attention";
import type { MonthPlanRow } from "@/db/queries/budget";

const TODAY = "2026-10-23";
const FROM = "2026-10-01";
const TO = "2026-10-31";

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
const spend = (platform: string, through: string, perDay: number) =>
  isoDaysBetween(FROM, through).map((date) => ({
    date,
    platform,
    objective: "Awareness" as const,
    spend: perDay,
    purchases: null,
    purchaseValue: null,
  }));
const days = isoDaysBetween(FROM, TO).map((date) => ({ date, revenueSar: 0, orders: 0 }));

function attention(args: {
  rows: ReturnType<typeof spend>;
  plans: MonthPlanRow[];
  coverage: Record<string, string>;
  today?: string;
}) {
  const model = buildRangeModel({
    from: FROM,
    to: TO,
    series: { spend: args.rows, days },
    plans: args.plans,
    rate: 3.75,
    platforms: [],
    coverage: args.coverage,
    storeHorizon: null,
    today: args.today ?? TODAY,
  });
  return buildAttention(model, args.coverage);
}

describe("buildAttention", () => {
  it("a month on plan has nothing to say", () => {
    expect(
      attention({
        rows: spend("instagram", "2026-10-22", 100),
        plans: [plan(["instagram"])],
        coverage: { instagram: "2026-10-22" },
      }),
    ).toEqual([]);
  });

  it("names a platform far over pace, with its run-rate over REPORTED days", () => {
    const items = attention({
      rows: spend("snapchat", "2026-10-20", 180),
      plans: [plan(["snapchat"])],
      coverage: { snapchat: "2026-10-20" },
    });
    // With no reserve at all, the projected overshoot leads the list.
    expect(items[0]).toMatchObject({ kind: "reserve", reserve: 0, exceededBy: 2480 });
    const item = items.find((i) => i.kind === "pace");
    expect(item).toMatchObject({
      kind: "pace",
      platform: "snapchat",
      direction: "ahead",
      runRate: 180,
      delta: 1600,
    });
    // 3,600 spent of 3,100: nothing left to spend, so no needed-per-day.
    expect(item && item.kind === "pace" && item.neededPerDay).toBeNull();
  });

  it("a platform behind says what each remaining day needs", () => {
    const [item] = attention({
      rows: spend("tiktok", "2026-10-21", 50),
      plans: [plan(["tiktok"])],
      coverage: { tiktok: "2026-10-21" },
    });
    // 1,050 spent of 3,100 with 10 days left → 205 a day, running 50.
    expect(item).toMatchObject({ kind: "pace", direction: "behind", runRate: 50, neededPerDay: 205 });
  });

  it("the reserve alert is the projections' draw against the reserve, at month end", () => {
    const items = attention({
      rows: spend("snapchat", "2026-10-20", 180),
      plans: [plan(["snapchat"], { reserveSpendUsd: 1000 })],
      coverage: { snapchat: "2026-10-20" },
    });
    // Lands at 180 × 31 = 5,580 against 3,100 → draws 2,480 of a 1,000 reserve.
    expect(items[0]).toEqual({
      kind: "reserve",
      projectedUse: 2480,
      reserve: 1000,
      exceededBy: 1480,
      used: 500,
    });
  });

  it("spend on an unplanned platform and a stale planned one are both named", () => {
    const items = attention({
      rows: [...spend("instagram", "2026-10-22", 100), ...spend("google", "2026-10-22", 10)],
      plans: [plan(["instagram", "tiktok"])],
      coverage: { instagram: "2026-10-22", google: "2026-10-22", tiktok: "2026-10-15" },
    });
    expect(items).toContainEqual({ kind: "unplanned", platform: "google", amount: 220 });
    expect(items).toContainEqual({
      kind: "stale",
      platform: "tiktok",
      date: "2026-10-15",
      daysBehind: 7,
    });
  });

  it("a month that is over is Review's subject — nothing to act on", () => {
    expect(
      attention({
        rows: spend("snapchat", "2026-10-31", 180),
        plans: [plan(["snapchat"])],
        coverage: { snapchat: "2026-10-31" },
        today: "2026-11-05",
      }),
    ).toEqual([]);
  });
});
