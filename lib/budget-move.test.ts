import { describe, expect, it } from "vitest";
import { isoDaysBetween } from "@/lib/budget";
import { buildRangeModel } from "@/lib/budget-range";
import { applyPlanMove, previewMove, type MovablePlan } from "@/lib/budget-move";

const plan: MovablePlan = {
  allocations: [
    { platform: "instagram", objective: "Awareness", plannedSpend: 1800 },
    { platform: "instagram", objective: "Retargeting", plannedSpend: 1200 },
    { platform: "tiktok", objective: "Awareness", plannedSpend: 1000 },
  ],
  reserveSpendUsd: 500,
};
const total = (p: MovablePlan) =>
  p.allocations.reduce((s, a) => s + a.plannedSpend, 0) + p.reserveSpendUsd;

describe("applyPlanMove — a transfer, never a re-plan", () => {
  it("platform to platform: exact dollars move, the total and the reserve don't", () => {
    const r = applyPlanMove(plan, { from: { kind: "platform", platform: "instagram" }, to: "tiktok", amount: 600 });
    if (!r.ok) throw new Error(r.error);
    expect(total(r)).toBe(total(plan));
    expect(r.reserveSpendUsd).toBe(500);
    // Instagram keeps its 60/40 split on the smaller amount.
    expect(r.allocations).toEqual([
      { platform: "instagram", objective: "Awareness", plannedSpend: 1440 },
      { platform: "instagram", objective: "Retargeting", plannedSpend: 960 },
      { platform: "tiktok", objective: "Awareness", plannedSpend: 1600 },
    ]);
  });

  it("from the reserve: the reserve shrinks by exactly the amount", () => {
    const r = applyPlanMove(plan, { from: { kind: "reserve" }, to: "instagram", amount: 250.55 });
    if (!r.ok) throw new Error(r.error);
    expect(r.reserveSpendUsd).toBe(249.45);
    expect(total(r)).toBeCloseTo(total(plan), 6);
    const ig = r.allocations.filter((a) => a.platform === "instagram").reduce((s, a) => s + a.plannedSpend, 0);
    expect(ig).toBeCloseTo(3250.55, 6);
  });

  it("emptying a platform drops its rows", () => {
    const r = applyPlanMove(plan, { from: { kind: "platform", platform: "tiktok" }, to: "instagram", amount: 1000 });
    if (!r.ok) throw new Error(r.error);
    expect(r.allocations.some((a) => a.platform === "tiktok")).toBe(false);
  });

  it("refuses what it cannot do, in words", () => {
    const from = { kind: "platform" as const, platform: "tiktok" };
    expect(applyPlanMove(plan, { from, to: "instagram", amount: 0 })).toMatchObject({ ok: false });
    expect(applyPlanMove(plan, { from, to: "instagram", amount: 1000.01 })).toEqual({
      ok: false,
      error: "That is more than the platform is planned.",
    });
    expect(applyPlanMove(plan, { from: { kind: "reserve" }, to: "instagram", amount: 501 })).toMatchObject({ ok: false });
    expect(applyPlanMove(plan, { from, to: "tiktok", amount: 10 })).toMatchObject({ ok: false });
    expect(applyPlanMove(plan, { from, to: "snapchat", amount: 10 })).toMatchObject({ ok: false });
  });
});

describe("previewMove — what each remaining day needs, before and after", () => {
  const spend = (platform: string, perDay: number) =>
    isoDaysBetween("2026-10-01", "2026-10-21").map((date) => ({
      date,
      platform,
      objective: "Awareness" as const,
      spend: perDay,
      purchases: null,
      purchaseValue: null,
    }));
  const model = buildRangeModel({
    from: "2026-10-01",
    to: "2026-10-31",
    series: { spend: [...spend("instagram", 100), ...spend("tiktok", 20)], days: [] },
    plans: [
      {
        month: "2026-10",
        allocations: [...plan.allocations],
        plannedRevenueSar: null,
        reserveSpendUsd: 500,
        dayWeights: {},
        planMode: "curve",
        planDays: [],
        targetRoas: null,
      },
    ],
    rate: 3.75,
    platforms: [],
    coverage: { instagram: "2026-10-21", tiktok: "2026-10-21" },
    storeHorizon: null,
    today: "2026-10-22",
  });

  it("uses the board's own needed-per-day on both sides of the move", () => {
    const lines = previewMove(model, plan, {
      from: { kind: "platform", platform: "instagram" },
      to: "tiktok",
      amount: 500,
    })!;
    // Instagram: 3,000 planned, 2,100 spent, 10 days left → 90/day; after: 40/day.
    expect(lines[0]).toEqual({ key: "instagram", planBefore: 3000, planAfter: 2500, neededBefore: 90, neededAfter: 40 });
    // TikTok: 1,000 planned, 420 spent → 58/day; after 1,500 → 108/day.
    expect(lines[1]).toEqual({ key: "tiktok", planBefore: 1000, planAfter: 1500, neededBefore: 58, neededAfter: 108 });
  });

  it("a reserve move shows the reserve's amounts and the target's days", () => {
    const lines = previewMove(model, plan, { from: { kind: "reserve" }, to: "tiktok", amount: 200 })!;
    expect(lines[0]).toMatchObject({ key: "reserve", planBefore: 500, planAfter: 300, neededAfter: null });
    expect(lines[1]).toMatchObject({ key: "tiktok", neededBefore: 58, neededAfter: 78 });
  });

  it("an impossible move has no preview", () => {
    expect(previewMove(model, plan, { from: { kind: "reserve" }, to: "tiktok", amount: 900 })).toBeNull();
  });
});
