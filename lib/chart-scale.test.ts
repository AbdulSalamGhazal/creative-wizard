import { describe, it, expect } from "vitest";
import { robustUpperBound } from "./chart-scale";

describe("robustUpperBound", () => {
  it("leaves well-behaved data untouched (no trim)", () => {
    const r = robustUpperBound([10, 12, 11, 13, 9, 14, 10, 12, 11, 13]);
    expect(r.trimmed).toBe(false);
    expect(r.cap).toBe(r.max);
  });

  it("trims a lone far-outlier spike and caps below it", () => {
    // bulk ~9–14, one spike at 500
    const values = [10, 12, 11, 13, 9, 14, 10, 12, 11, 13, 500];
    const r = robustUpperBound(values);
    expect(r.trimmed).toBe(true);
    expect(r.max).toBe(500);
    expect(r.cap).toBeLessThan(500);
    expect(r.cap).toBeGreaterThanOrEqual(14); // bulk stays visible
  });

  it("does NOT trim when many points are high (a real cluster, not an anomaly)", () => {
    const values = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 11, 12, 90, 95, 88, 92];
    const r = robustUpperBound(values);
    expect(r.trimmed).toBe(false);
  });

  it("does not trim with too few points", () => {
    const r = robustUpperBound([1, 2, 100]);
    expect(r.trimmed).toBe(false);
    expect(r.cap).toBe(100);
  });

  it("handles empty / all-zero input", () => {
    expect(robustUpperBound([]).trimmed).toBe(false);
    expect(robustUpperBound([0, 0, 0, 0, 0]).trimmed).toBe(false);
  });

  it("ignores non-finite values", () => {
    const r = robustUpperBound([10, 12, 11, 13, 9, 14, NaN, Infinity, 500]);
    expect(r.trimmed).toBe(true);
    expect(r.max).toBe(500);
    expect(r.cap).toBeLessThan(500);
  });
});
