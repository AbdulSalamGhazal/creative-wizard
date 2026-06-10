import { describe, expect, it } from "vitest";
import { mixRateDecomposition, type PeriodCreative } from "./decomposition";

const c = (id: string, spend: number, rev: number): PeriodCreative => ({
  id,
  name: id,
  spend,
  rev,
});

describe("mixRateDecomposition", () => {
  it("reconciles exactly: mix + rate === roasB − roasA (random inputs)", () => {
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(Math.random() * 6);
      const A: PeriodCreative[] = [];
      const B: PeriodCreative[] = [];
      for (let i = 0; i < n; i++) {
        // Some creatives present in only one period.
        if (Math.random() > 0.2) {
          const s = Math.random() * 1000;
          A.push(c(`x${i}`, s, s * Math.random() * 4));
        }
        if (Math.random() > 0.2) {
          const s = Math.random() * 1000;
          B.push(c(`x${i}`, s, s * Math.random() * 4));
        }
      }
      if (A.length === 0 || B.length === 0) continue;
      const r = mixRateDecomposition(A, B);
      expect(Math.abs(r.mix + r.rate - r.delta)).toBeLessThan(1e-9);
      // contrib totals also sum to delta.
      const contribSum = r.contrib.reduce((a, x) => a + x.total, 0);
      expect(Math.abs(contribSum - r.delta)).toBeLessThan(1e-9);
    }
  });

  it("mix-only: shares move, each creative's ROAS constant ⇒ rate ≈ 0", () => {
    // c1 ROAS 2×, c2 ROAS 1× in both periods; only the spend mix shifts.
    const A = [c("a", 100, 200), c("b", 100, 100)];
    const B = [c("a", 150, 300), c("b", 50, 50)];
    const r = mixRateDecomposition(A, B);
    expect(Math.abs(r.rate)).toBeLessThan(1e-9);
    expect(Math.abs(r.mix)).toBeGreaterThan(0);
    expect(Math.abs(r.mix + r.rate - r.delta)).toBeLessThan(1e-9);
  });

  it("rate-only: shares constant, a creative's ROAS changes ⇒ mix ≈ 0", () => {
    const A = [c("a", 100, 100), c("b", 100, 100)];
    const B = [c("a", 100, 200), c("b", 100, 100)]; // a's ROAS 1×→2×, shares 50/50
    const r = mixRateDecomposition(A, B);
    expect(Math.abs(r.mix)).toBeLessThan(1e-9);
    expect(r.rate).toBeCloseTo(0.5, 9); // ΔROAS = 1.5 − 1.0
  });

  it("single creative ⇒ no mix effect", () => {
    const A = [c("a", 100, 100)];
    const B = [c("a", 200, 400)];
    const r = mixRateDecomposition(A, B);
    expect(Math.abs(r.mix)).toBeLessThan(1e-9);
    expect(r.rate).toBeCloseTo(r.delta, 9);
  });

  it("creative absent in A reconciles (pure mix entry)", () => {
    const A = [c("a", 100, 200)];
    const B = [c("a", 100, 200), c("b", 100, 50)]; // b is new
    const r = mixRateDecomposition(A, B);
    expect(Math.abs(r.mix + r.rate - r.delta)).toBeLessThan(1e-9);
  });
});
