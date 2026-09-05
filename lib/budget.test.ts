import { describe, expect, it } from "vitest";
import {
  monthStartIso,
  daysInMonth,
  prevMonthKey,
  nextMonthKey,
  monthLabel,
  elapsedDaysInMonth,
  pacingExpected,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  variance,
  variancePct,
  roasThroughRate,
  validateRate,
  spendInDisplayCurrency,
  PACING_WARN_THRESHOLD,
} from "@/lib/budget";

describe("month helpers", () => {
  it("month lengths incl. leap February", () => {
    expect(daysInMonth("2026-01-01")).toBe(31);
    expect(daysInMonth("2026-02-01")).toBe(28);
    expect(daysInMonth("2028-02-01")).toBe(29); // leap
    expect(daysInMonth("2026-09-01")).toBe(30);
  });
  it("prev/next month roll over years", () => {
    expect(prevMonthKey("2026-01")).toBe("2025-12");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
    expect(monthStartIso("2026-09")).toBe("2026-09-01");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
  it("elapsed days: day 1, last day, past + future months", () => {
    expect(elapsedDaysInMonth("2026-09", "2026-09-01")).toBe(1); // day 1 counts
    expect(elapsedDaysInMonth("2026-09", "2026-09-30")).toBe(30); // last day
    expect(elapsedDaysInMonth("2026-08", "2026-09-05")).toBe(31); // past → full
    expect(elapsedDaysInMonth("2026-10", "2026-09-05")).toBe(0); // future → none
  });
});

describe("pacing", () => {
  it("expected-to-date is linear over the month", () => {
    expect(pacingExpected(3000, 10, 30)).toBe(1000);
    expect(pacingExpected(3100, 31, 31)).toBe(3100); // last day → full plan
  });
  it("deviation is null with nothing expected; signed otherwise", () => {
    expect(pacingDeviation(50, 0)).toBeNull();
    expect(pacingDeviation(1200, 1000)).toBeCloseTo(0.2, 6);
    expect(pacingDeviation(800, 1000)).toBeCloseTo(-0.2, 6);
  });
  it("tone warns by |magnitude| — ahead and behind alike", () => {
    expect(pacingTone(null)).toBe("muted");
    expect(pacingTone(0.1)).toBe("muted");
    expect(pacingTone(PACING_WARN_THRESHOLD)).toBe("warn");
    expect(pacingTone(-PACING_WARN_THRESHOLD)).toBe("warn");
  });
  it("verdict words the magnitude", () => {
    expect(pacingVerdict(null)).toBe("—");
    expect(pacingVerdict(0.001)).toBe("on track");
    expect(pacingVerdict(0.12)).toBe("12% ahead");
    expect(pacingVerdict(-0.08)).toBe("8% behind");
  });
});

describe("variance + ROAS-through-rate + rate", () => {
  it("variance and variance%: null % when there is no plan", () => {
    expect(variance(1200, 1000)).toBe(200);
    expect(variancePct(1200, 1000)).toBeCloseTo(0.2, 6);
    expect(variancePct(500, 0)).toBeNull();
  });
  it("ROAS always goes through the rate; null on zero spend or bad rate", () => {
    expect(roasThroughRate(3770, 500, 3.77)).toBeCloseTo(2, 6); // 3770/(500*3.77)
    expect(roasThroughRate(1000, 0, 3.77)).toBeNull();
    expect(roasThroughRate(1000, 100, 0)).toBeNull();
  });
  it("rate validation: > 0, ≤ 100, finite", () => {
    expect(validateRate(3.77)).toBe(true);
    expect(validateRate(0)).toBe(false);
    expect(validateRate(-1)).toBe(false);
    expect(validateRate(100.01)).toBe(false);
    expect(validateRate(Number.NaN)).toBe(false);
  });
  it("display conversion only applies on the SAR side of the toggle", () => {
    expect(spendInDisplayCurrency(100, "USD", 3.77)).toBe(100);
    expect(spendInDisplayCurrency(100, "SAR", 3.77)).toBeCloseTo(377, 6);
  });
});
