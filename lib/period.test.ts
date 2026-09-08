import { describe, expect, it } from "vitest";
import { addDays, computeDelta, dayCount, prevPeriod } from "@/lib/period";

describe("dayCount — inclusive", () => {
  it("counts both endpoints", () => {
    expect(dayCount("2026-05-01", "2026-05-07")).toBe(7);
    expect(dayCount("2026-05-01", "2026-05-01")).toBe(1); // a single day is 1
  });

  it("crosses months, years and a leap day", () => {
    expect(dayCount("2026-01-31", "2026-02-01")).toBe(2);
    expect(dayCount("2026-12-31", "2027-01-01")).toBe(2);
    expect(dayCount("2028-02-28", "2028-03-01")).toBe(3); // 2028 is a leap year
  });

  it("garbage in → 0, not NaN", () => {
    expect(dayCount("nonsense", "2026-05-07")).toBe(0);
  });
});

describe("prevPeriod — the immediately preceding window of equal length", () => {
  it("abuts the range without overlapping it", () => {
    const prev = prevPeriod("2026-05-08", "2026-05-14"); // a 7-day window
    expect(prev).toEqual({ from: "2026-05-01", to: "2026-05-07" });
    expect(dayCount(prev.from, prev.to)).toBe(7); // same length
    expect(prev.to < "2026-05-08").toBe(true); // and strictly before it
  });

  it("a single day compares against the day before", () => {
    expect(prevPeriod("2026-05-01", "2026-05-01")).toEqual({
      from: "2026-04-30",
      to: "2026-04-30",
    });
  });

  it("walks back across a year boundary", () => {
    expect(prevPeriod("2027-01-01", "2027-01-31")).toEqual({
      from: "2026-12-01", // Jan 1–31 is 31 days, so the prior 31 days is all of Dec
      to: "2026-12-31",
    });
  });
});

describe("addDays — UTC, no DST drift", () => {
  it("moves forward and backward across month ends", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 is not leap
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-05-10", 0)).toBe("2026-05-10");
  });
});

/**
 * The delta modes exist so the UI can say "new" instead of "+∞%" and "gone"
 * instead of "-100%" — a divide-by-zero rendered as a percentage is the bug
 * these guard.
 */
describe("computeDelta — modes", () => {
  it("a real percentage when both sides have magnitude", () => {
    expect(computeDelta(118.3, 100)).toEqual({ pct: expect.closeTo(0.183, 6), mode: "pct" });
    expect(computeDelta(50, 100)).toEqual({ pct: -0.5, mode: "pct" });
    expect(computeDelta(100, 100)).toEqual({ pct: 0, mode: "pct" });
  });

  it("appearing from nothing is 'new', not a division by zero", () => {
    expect(computeDelta(42, 0)).toEqual({ pct: null, mode: "new" });
    expect(computeDelta(42, null)).toEqual({ pct: null, mode: "new" });
  });

  it("falling to nothing is 'removed'", () => {
    expect(computeDelta(0, 42)).toEqual({ pct: -1, mode: "removed" });
    expect(computeDelta(null, 42)).toEqual({ pct: -1, mode: "removed" });
  });

  it("absent on both sides is 'absent', not 0%", () => {
    expect(computeDelta(null, null)).toEqual({ pct: null, mode: "absent" });
    expect(computeDelta(0, 0)).toEqual({ pct: null, mode: "absent" });
  });
});
