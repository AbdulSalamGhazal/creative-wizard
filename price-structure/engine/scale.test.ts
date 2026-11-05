import { describe, expect, it } from "vitest";
import { axisPosition, niceAxis } from "./scale";

describe("niceAxis", () => {
  it("rounds to 1 · 2 · 5 steps and covers every value", () => {
    const a = niceAxis([0, 0.2752, 0.25, 0.35, 0.3493]);
    expect(a.min).toBe(0);
    // 0.35 ÷ 5 = 0.07 sits on the 5-vs-10 boundary; either rounding covers the data.
    expect(a.max).toBeGreaterThanOrEqual(0.35 - 1e-9);
    expect(a.max).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(a.ticks.length).toBeGreaterThan(3);
    const b = niceAxis([0, 3.59, 6.03, 5.28, 4.42, 6.55]);
    expect(b.step).toBe(1);
    expect(b.max).toBe(7);
    expect(b.ticks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(niceAxis([0, 52113]).step).toBe(10000);
  });
  it("ignores infinities and survives a flat set", () => {
    expect(niceAxis([Infinity, 2, 4]).max).toBeGreaterThanOrEqual(4);
    expect(niceAxis([5, 5]).max).toBeGreaterThan(5);
    expect(niceAxis([]).max).toBe(1);
  });
  it("positions clamp to the ends", () => {
    const a = niceAxis([0, 10]);
    expect(axisPosition(a, 5)).toBe(0.5);
    expect(axisPosition(a, Infinity)).toBe(1);
    expect(axisPosition(a, -Infinity)).toBe(0);
    expect(axisPosition(a, 50)).toBe(1);
  });
});
