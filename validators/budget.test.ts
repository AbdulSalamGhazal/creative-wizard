import { describe, expect, it } from "vitest";
import { MONTH_KEY, planSchema, WEIGHT_MAX, WEIGHT_MIN } from "@/validators/budget";

const base = {
  month: "2026-09",
  allocations: [],
  plannedRevenueSar: null,
};

const withWeight = (weight: number) =>
  planSchema.safeParse({ ...base, dayWeights: [{ day: 27, weight }] });

// The server rejects any day weight the Plan editor's clamp could not have
// produced (0.5..10). `validateWeight` in lib/budget.ts stays looser on purpose
// — it guards values read back FROM the DB (a legacy sub-0.5 row must keep
// working and keep copying), not values coming IN over the wire.
describe("planSchema day-weight bounds", () => {
  it("accepts the clamp's endpoints and a normal payday weight", () => {
    for (const w of [WEIGHT_MIN, 1, 3, WEIGHT_MAX]) {
      expect(withWeight(w).success, `expected ${w} to be valid`).toBe(true);
    }
  });

  it("rejects weights below the clamp — including ones validateWeight allows", () => {
    // 0.25 is > 0 and ≤ 10, so lib/budget's validateWeight would pass it; the
    // wire schema must not.
    for (const w of [0.25, 0, -1]) {
      expect(withWeight(w).success, `expected ${w} to be rejected`).toBe(false);
    }
  });

  it("rejects weights above the clamp", () => {
    for (const w of [10.5, 99]) {
      expect(withWeight(w).success, `expected ${w} to be rejected`).toBe(false);
    }
  });

  it("defaults dayWeights and reserve when omitted", () => {
    const res = planSchema.safeParse(base);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.dayWeights).toEqual([]);
      expect(res.data.reserveSpendUsd).toBe(0);
    }
  });
});

describe("MONTH_KEY", () => {
  it("accepts real months and rejects impossible ones", () => {
    for (const m of ["2026-01", "2026-09", "2026-12"]) {
      expect(MONTH_KEY.test(m), `${m} should be valid`).toBe(true);
    }
    // `2026-13` used to pass `\d{2}` and produce a nonsense month downstream.
    for (const m of ["2026-00", "2026-13", "2026-99", "2026-1", "26-01", "2026-ab"]) {
      expect(MONTH_KEY.test(m), `${m} should be rejected`).toBe(false);
    }
  });
});
