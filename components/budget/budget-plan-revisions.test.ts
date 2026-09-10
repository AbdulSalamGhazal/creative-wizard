import { describe, expect, it } from "vitest";
import { diffPlans, type CurrentPlan } from "@/components/budget/budget-plan-revisions";
import type { BudgetPlanSnapshot } from "@/validators/budget";

const snapshot = (over: Partial<BudgetPlanSnapshot> = {}): BudgetPlanSnapshot => ({
  allocations: [{ platform: "instagram", objective: "Awareness", plannedSpend: 1_000 }],
  plannedRevenueSar: 25_000,
  reserveSpendUsd: 500,
  dayWeights: {},
  ...over,
});

const current = (over: Partial<CurrentPlan> = {}): CurrentPlan => ({
  allocations: [{ platform: "instagram", objective: "Awareness", plannedSpend: 1_000 }],
  plannedRevenueSar: 25_000,
  reserveSpendUsd: 500,
  dayWeights: {},
  ...over,
});

/**
 * The drawer's "restoring would change nothing" claim has to be true. It used
 * to compare only how MANY days were weighted, so a payday moved from the 15th
 * to the 20th read as identical — and restoring would have silently reshaped
 * the month's pacing.
 */
describe("diffPlans", () => {
  it("reports an untouched plan as identical", () => {
    const d = diffPlans(snapshot(), current());
    expect(d.identical).toBe(true);
    expect(d.rows).toHaveLength(0);
    expect(d.weightsChanged).toBe(false);
  });

  it("catches a payday that MOVED even though the count is the same", () => {
    const d = diffPlans(
      snapshot({ dayWeights: { "15": 2 } }),
      current({ dayWeights: { 20: 2 } }),
    );
    expect(d.weightsChanged).toBe(true);
    expect(d.identical).toBe(false);
    // Same count either side — the old count-only check saw nothing here.
    expect(d.revWeights).toBe(1);
    expect(d.curWeights).toBe(1);
  });

  it("catches a payday whose WEIGHT changed", () => {
    const d = diffPlans(
      snapshot({ dayWeights: { "15": 2 } }),
      current({ dayWeights: { 15: 3 } }),
    );
    expect(d.weightsChanged).toBe(true);
    expect(d.identical).toBe(false);
  });

  it("treats a stored weight of 1 as no override", () => {
    const d = diffPlans(
      snapshot({ dayWeights: { "15": 2, "16": 1 } }),
      current({ dayWeights: { 15: 2 } }),
    );
    expect(d.weightsChanged).toBe(false);
    expect(d.identical).toBe(true);
  });

  it("still reports added, removed and changed allocations", () => {
    const d = diffPlans(
      snapshot({
        allocations: [
          { platform: "instagram", objective: "Awareness", plannedSpend: 1_200 },
          { platform: "tiktok", objective: "Other", plannedSpend: 300 },
        ],
      }),
      current({
        allocations: [
          { platform: "instagram", objective: "Awareness", plannedSpend: 1_000 },
          { platform: "facebook", objective: "Retargeting", plannedSpend: 400 },
        ],
      }),
    );
    expect(d.identical).toBe(false);
    const byKind = Object.fromEntries(d.rows.map((r) => [r.key, r.kind]));
    expect(byKind["instagram|Awareness"]).toBe("changed");
    expect(byKind["tiktok|Other"]).toBe("removed"); // restoring brings it back
    expect(byKind["facebook|Retargeting"]).toBe("added"); // restoring drops it
  });

  it("notices a revenue-target or reserve change on its own", () => {
    expect(diffPlans(snapshot(), current({ plannedRevenueSar: 30_000 })).identical).toBe(false);
    expect(diffPlans(snapshot(), current({ reserveSpendUsd: 0 })).identical).toBe(false);
  });
});
