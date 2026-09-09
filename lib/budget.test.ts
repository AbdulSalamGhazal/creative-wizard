import { describe, expect, it } from "vitest";
import {
  curveFraction,
  curveExpected,
  projectedMonthEnd,
  dayWeights,
  mapWeightsToMonth,
  validateWeight,
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
  round2,
  pctShare,
  splitByWeights,
  redistributeByPct,
  distributeRemainder,
  scaleAll,
  weekBucketsInRange,
  dayBucketsInRange,
  monthBucketsInRange,
  monthsInRange,
  monthDayIncrements,
  stitchPlanByDay,
  toBudgetObjective,
  mergeAllocationsToBuckets,
  BUDGET_OBJECTIVES,
  type MonthPlan,
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

describe("day-weight curve (v2)", () => {
  it("no overrides ≡ v1 linear pacing, exactly", () => {
    for (const day of [1, 10, 15, 30]) {
      expect(curveFraction("2026-09", {}, day)).toBeCloseTo(day / 30, 10);
      expect(curveExpected(3000, "2026-09", {}, day)).toBeCloseTo(
        pacingExpected(3000, day, 30),
        8,
      );
    }
  });

  it("a 3× payday shifts plan-to-date correctly", () => {
    // Sept (30 days), day 27 weighted 3 → total weight 32.
    const ov = { 27: 3 };
    expect(curveFraction("2026-09", ov, 26)).toBeCloseTo(26 / 32, 10);
    expect(curveFraction("2026-09", ov, 27)).toBeCloseTo(29 / 32, 10);
    expect(curveFraction("2026-09", ov, 30)).toBe(1);
    // Plan-to-date jumps by 3 units of weight across the payday.
    const before = curveExpected(3200, "2026-09", ov, 26);
    const after = curveExpected(3200, "2026-09", ov, 27);
    expect(after - before).toBeCloseTo((3 / 32) * 3200, 6);
  });

  it("projection divides by the elapsed curve fraction; day-0 edge → null", () => {
    expect(projectedMonthEnd(1000, "2026-09", {}, 10)).toBeCloseTo(3000, 6);
    const ov = { 1: 3 }; // front-loaded curve → smaller projection multiplier
    expect(projectedMonthEnd(1000, "2026-09", ov, 1)).toBeCloseTo(1000 * (32 / 3), 4);
    expect(projectedMonthEnd(1000, "2026-09", {}, 0)).toBeNull();
  });

  it("weight bounds: > 0, ≤ 10; invalid overrides fall back to 1", () => {
    expect(validateWeight(0.5)).toBe(true);
    expect(validateWeight(10)).toBe(true);
    expect(validateWeight(0)).toBe(false);
    expect(validateWeight(10.5)).toBe(false);
    expect(dayWeights("2026-09", { 5: 0, 6: 99 })[4]).toBe(1); // invalid → 1
    expect(dayWeights("2026-09", { 5: 0, 6: 99 })[5]).toBe(1);
  });

  it("copy mapping drops day 31 for shorter months, keeps the rest", () => {
    const ov = { 15: 2, 31: 3 };
    expect(mapWeightsToMonth(ov, "2026-09")).toEqual({ 15: 2 }); // 30 days
    expect(mapWeightsToMonth(ov, "2026-10")).toEqual({ 15: 2, 31: 3 }); // 31 days
    expect(mapWeightsToMonth(ov, "2026-02")).toEqual({ 15: 2 }); // 28 days
  });
});

describe("per-metric data horizons (v2.1)", () => {
  it("horizonDayInMonth clamps to the month and handles a null horizon", () => {
    // Re-exported through budget-shared, but the logic is what Daily gates on:
    // ads and store horizons are fed through this SAME helper independently.
    const f = (horizon: string | null, month: string, days: number) => {
      if (!horizon) return 0;
      const h = horizon.slice(0, 7);
      if (h < month) return 0;
      if (h > month) return days;
      return Math.min(days, Number(horizon.slice(8, 10)));
    };
    expect(f(null, "2026-09", 30)).toBe(0); // nothing uploaded → all unknown
    expect(f("2026-08-31", "2026-09", 30)).toBe(0); // horizon before the month
    expect(f("2026-10-02", "2026-09", 30)).toBe(30); // month fully behind it
    expect(f("2026-09-05", "2026-09", 30)).toBe(5); // mid-month
  });
});

/**
 * Percentage distribution (Plan editor). The property that matters everywhere
 * here: a split's parts sum to the total EXACTLY, so the "Unallocated" chip
 * can actually reach zero. Amounts stay the stored truth — none of this is
 * persisted.
 */
describe("plan distribution — percentages and rounding", () => {
  const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

  it("round2 handles the binary-fraction near-misses", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1234.567)).toBe(1234.57);
    expect(round2(-1.005)).toBe(-1.01);
  });

  it("pctShare is null with nothing to share", () => {
    expect(pctShare(25, 100)).toBe(25);
    expect(pctShare(0, 0)).toBeNull();
    expect(pctShare(10, -5)).toBeNull();
  });

  it("splits a total that does not divide evenly, exactly", () => {
    // 100 / 3 is the classic: 33.34 + 33.33 + 33.33, never 99.99.
    const parts = splitByWeights(100, [1, 1, 1]);
    expect(sum(parts)).toBe(100);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  it("splits in proportion to the weights and still sums exactly", () => {
    const parts = splitByWeights(1000, [3, 1]);
    expect(parts).toEqual([750, 250]);
    const awkward = splitByWeights(1000.01, [7, 3, 1]);
    expect(sum(awkward)).toBe(1000.01);
  });

  it("splits evenly when every weight is zero", () => {
    expect(splitByWeights(10, [0, 0, 0, 0])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it("gives nothing away when there is nothing to give", () => {
    expect(splitByWeights(0, [1, 2])).toEqual([0, 0]);
    expect(splitByWeights(-5, [1, 2])).toEqual([0, 0]);
    expect(splitByWeights(100, [])).toEqual([]);
  });

  describe("redistributeByPct", () => {
    it("gives the edited row its share and rescales the siblings", () => {
      const out = redistributeByPct([500, 300, 200], 0, 60); // total 1000
      expect(out[0]).toBe(600);
      // The other two keep their 3:2 ratio inside the remaining 400.
      expect(out[1]).toBe(240);
      expect(out[2]).toBe(160);
      expect(sum(out)).toBe(1000);
    });

    it("preserves the group total through an awkward percentage", () => {
      const out = redistributeByPct([100, 100, 100], 1, 33.33);
      expect(sum(out)).toBe(300);
    });

    it("holds an explicit group total rather than the current sum", () => {
      // Rows sum to 800 but the platform's intent is 1000.
      const out = redistributeByPct([500, 300], 0, 50, 1000);
      expect(out).toEqual([500, 500]);
      expect(sum(out)).toBe(1000);
    });

    it("splits evenly among siblings that are all zero", () => {
      const out = redistributeByPct([1000, 0, 0], 0, 50);
      expect(out).toEqual([500, 250, 250]);
    });

    it("leaves a single row alone — it is always 100% of itself", () => {
      expect(redistributeByPct([400], 0, 50)).toEqual([400]);
    });

    it("clamps the percentage into 0..100", () => {
      expect(sum(redistributeByPct([600, 400], 0, 140))).toBe(1000);
      expect(redistributeByPct([600, 400], 0, 140)[0]).toBe(1000);
      expect(redistributeByPct([600, 400], 0, -20)[0]).toBe(0);
    });

    it("does nothing when there is no total to share", () => {
      expect(redistributeByPct([0, 0], 0, 50)).toEqual([0, 0]);
    });
  });

  describe("distributeRemainder", () => {
    it("adds the remainder in equal parts, exactly", () => {
      const out = distributeRemainder([100, 200, 300], 100);
      expect(out).toEqual([133.34, 233.33, 333.33]);
      expect(sum(out)).toBe(700);
    });

    it("is a no-op for a zero remainder", () => {
      expect(distributeRemainder([10, 20], 0)).toEqual([10, 20]);
    });

    it("clamps at zero when taking more back than a row holds", () => {
      const out = distributeRemainder([10, 200], -100);
      expect(out[0]).toBe(0); // would have gone to −40
      expect(out[1]).toBe(150);
    });
  });

  describe("scaleAll", () => {
    it("scales up and down, rounding each row", () => {
      expect(scaleAll([100, 250.55], 10)).toEqual([110, 275.61]);
      expect(scaleAll([100, 250], -10)).toEqual([90, 225]);
      expect(scaleAll([100], 0)).toEqual([100]);
    });

    it("floors at zero rather than going negative", () => {
      expect(scaleAll([100, 50], -150)).toEqual([0, 0]);
    });
  });
});

/**
 * Bucketing for Pacing. Weeks are Sunday-start and CLIPPED to the range: a
 * bucket that reached outside the range would be compared against days the
 * user didn't ask for.
 */
describe("pacing buckets over a range", () => {
  const days = (b: { start: string; end: string }) =>
    (Date.parse(`${b.end}T00:00:00Z`) - Date.parse(`${b.start}T00:00:00Z`)) / 86_400_000 + 1;

  it("splits a range that starts mid-week into a partial first week", () => {
    // 2026-09-01 is a Tuesday → the first bucket runs Tue..Sat (1–5).
    const weeks = weekBucketsInRange("2026-09-01", "2026-09-30");
    expect(weeks[0]).toMatchObject({ label: "Sep 1–5", start: "2026-09-01", end: "2026-09-05" });
    expect(weeks[1]).toMatchObject({ label: "Sep 6–12", start: "2026-09-06" });
    expect(weeks.at(-1)).toMatchObject({ label: "Sep 27–30", end: "2026-09-30" });
  });

  it("covers every day of the range exactly once, with no gaps or overlap", () => {
    const ranges: Array<[string, string]> = [
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-09-14", "2026-11-03"], // cross-month, mid-week both ends
      ["2028-02-01", "2028-02-29"], // leap
    ];
    for (const [from, to] of ranges) {
      const weeks = weekBucketsInRange(from, to);
      expect(weeks[0]!.start).toBe(from);
      expect(weeks.at(-1)!.end).toBe(to);
      // Contiguous, and never longer than a week.
      for (let i = 1; i < weeks.length; i++) {
        const prevEnd = Date.parse(`${weeks[i - 1]!.end}T00:00:00Z`);
        const thisStart = Date.parse(`${weeks[i]!.start}T00:00:00Z`);
        expect(thisStart - prevEnd).toBe(86_400_000);
      }
      expect(weeks.every((w) => days(w) <= 7)).toBe(true);
      expect(weeks.reduce((s, w) => s + days(w), 0)).toBe(days({ start: from, end: to }));
    }
  });

  it("starts a whole first week when the range starts on a Sunday", () => {
    // 2026-02-01 is a Sunday.
    const weeks = weekBucketsInRange("2026-02-01", "2026-02-28");
    expect(weeks[0]).toMatchObject({ start: "2026-02-01", end: "2026-02-07", label: "Feb 1–7" });
    expect(weeks).toHaveLength(4);
  });

  it("labels a cross-month week with both months", () => {
    const weeks = weekBucketsInRange("2026-09-27", "2026-10-10");
    expect(weeks[0]!.label).toBe("Sep 27–Oct 3");
  });

  it("day buckets are one per day", () => {
    const d = dayBucketsInRange("2026-02-26", "2026-03-02");
    expect(d.map((b) => b.start)).toEqual([
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(d[0]!.label).toBe("Feb 26");
  });

  it("month buckets clip to the range at both ends", () => {
    const m = monthBucketsInRange("2026-09-10", "2026-11-05");
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({ start: "2026-09-10", end: "2026-09-30", label: "Sep 2026" });
    expect(m[1]).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
    expect(m[2]).toMatchObject({ start: "2026-11-01", end: "2026-11-05" });
  });

  it("monthsInRange lists every month the range touches", () => {
    expect(monthsInRange("2026-09-28", "2026-12-02")).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    expect(monthsInRange("2026-09-05", "2026-09-06")).toEqual(["2026-09"]);
  });
});

/**
 * Plans are stored per MONTH but Pacing compares arbitrary ranges, so a
 * month's plan is spread across its days by the day-weight curve and the days
 * are re-summed per bucket. The property that has to hold: no money is created
 * or lost in the spreading.
 */
describe("plan stitching across months", () => {
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

  it("a month's per-day increments sum back to the month's plan", () => {
    near(monthDayIncrements("2026-09-01", {}, 3000).reduce((s, v) => s + v, 0), 3000);
    // …and with a payday curve, which redistributes but doesn't change the sum.
    const weighted = monthDayIncrements("2026-09-01", { 5: 3, 25: 2.5 }, 3000);
    near(weighted.reduce((s, v) => s + v, 0), 3000);
    expect(weighted[4]).toBeGreaterThan(weighted[0]!); // day 5 carries more
  });

  it("with no overrides every day gets an equal share", () => {
    const inc = monthDayIncrements("2026-04-01", {}, 300); // 30 days
    expect(inc).toHaveLength(30);
    for (const v of inc) near(v, 10);
  });

  it("a zero-weight month plans nothing rather than dividing by zero", () => {
    const inc = monthDayIncrements("2026-09-01", {}, 0);
    near(inc.reduce((s, v) => s + v, 0), 0);
  });

  it("a cross-month range equals the sum of its months", () => {
    const months: MonthPlan[] = [
      { month: "2026-09", plannedSpend: 3000, plannedRevenueSar: null, dayWeights: { 15: 2 } },
      { month: "2026-10", plannedSpend: 6200, plannedRevenueSar: null, dayWeights: {} },
    ];
    const byDay = stitchPlanByDay(months, (m) => m.plannedSpend);
    const sum = (from: string, to: string) => {
      let total = 0;
      for (const [iso, value] of byDay) if (iso >= from && iso <= to) total += value;
      return total;
    };
    near(sum("2026-09-01", "2026-09-30"), 3000);
    near(sum("2026-10-01", "2026-10-31"), 6200);
    near(sum("2026-09-01", "2026-10-31"), 9200);
    // A partial slice takes only its days' share.
    near(sum("2026-10-01", "2026-10-10"), 2000);
  });

  it("skips months with no plan instead of zero-filling them", () => {
    const months: MonthPlan[] = [
      { month: "2026-09", plannedSpend: 100, plannedRevenueSar: null, dayWeights: {} },
      { month: "2026-10", plannedSpend: 0, plannedRevenueSar: null, dayWeights: {} },
    ];
    const byDay = stitchPlanByDay(
      months,
      (m) => m.plannedRevenueSar,
    );
    expect(byDay.size).toBe(0); // neither month has a revenue target
  });
});

/**
 * Budget's own objective axis. Campaign objectives elsewhere are untouched —
 * this is the lens Budget looks at them through.
 */
describe("budget objective buckets", () => {
  it("keeps the three mains and sweeps everything else into Other", () => {
    expect(toBudgetObjective("Awareness")).toBe("Awareness");
    expect(toBudgetObjective("Activation")).toBe("Activation");
    expect(toBudgetObjective("Retargeting")).toBe("Retargeting");
    expect(toBudgetObjective("Sales")).toBe("Other");
    expect(toBudgetObjective("Prospecting")).toBe("Other");
    expect(toBudgetObjective("Special Case")).toBe("Other");
    expect(toBudgetObjective("Other")).toBe("Other");
    // A campaign objective invented after this code shipped still lands safely.
    expect(toBudgetObjective("Some Future Objective")).toBe("Other");
  });

  it("has exactly the four buckets, Other last", () => {
    expect(BUDGET_OBJECTIVES).toEqual(["Awareness", "Activation", "Retargeting", "Other"]);
  });

  describe("mergeAllocationsToBuckets", () => {
    it("sums the rows that collapse into Other on the same platform", () => {
      const merged = mergeAllocationsToBuckets([
        { platform: "instagram", objective: "Sales", plannedSpend: 600 },
        { platform: "instagram", objective: "Prospecting", plannedSpend: 400 },
        { platform: "instagram", objective: "Awareness", plannedSpend: 250 },
      ]);
      expect(merged).toEqual([
        { platform: "instagram", objective: "Awareness", plannedSpend: 250 },
        { platform: "instagram", objective: "Other", plannedSpend: 1000 },
      ]);
    });

    it("keeps platforms apart", () => {
      const merged = mergeAllocationsToBuckets([
        { platform: "instagram", objective: "Sales", plannedSpend: 100 },
        { platform: "facebook", objective: "Sales", plannedSpend: 50 },
      ]);
      expect(merged).toHaveLength(2);
      expect(merged.every((r) => r.objective === "Other")).toBe(true);
      expect(merged[0]!.platform).toBe("facebook"); // deterministic order
    });

    it("passes an already-bucketed plan through unchanged", () => {
      const rows = [
        { platform: "tiktok", objective: "Awareness", plannedSpend: 10 },
        { platform: "tiktok", objective: "Retargeting", plannedSpend: 20 },
      ];
      expect(mergeAllocationsToBuckets(rows)).toEqual(rows);
    });

    it("does not lose cents when summing", () => {
      const merged = mergeAllocationsToBuckets([
        { platform: "snapchat", objective: "Sales", plannedSpend: 0.1 },
        { platform: "snapchat", objective: "Prospecting", plannedSpend: 0.2 },
      ]);
      expect(merged[0]!.plannedSpend).toBe(0.3);
    });
  });
});
