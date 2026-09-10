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
  distributeRemainder,
  isValidIsoDate,
  clampRangeMonths,
  monthSpan,
  MAX_RANGE_MONTHS,
  planGateProblems,
  weekBucketsInRange,
  dayBucketsInRange,
  monthBucketsInRange,
  monthsInRange,
  monthDayIncrements,
  stitchPlanByDay,
  toBudgetObjective,
  mergeAllocationsToBuckets,
  BUDGET_OBJECTIVES,
  allocatableFromTotal,
  reserveShare,
  reserveFromShare,
  amountsFromShares,
  shareFromAmount,
  shareRemainder,
  sharesComplete,
  distributeShareEvenly,
  moveMoney,
  normalizeShares,
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
  it("no overrides ≡ plain linear pacing, exactly", () => {
    // The unit-pin: a month with no weighted days must behave EXACTLY like a
    // flat day-by-day spread, which is what Budget did before the curve.
    for (const day of [1, 10, 15, 30]) {
      expect(curveFraction("2026-09", {}, day)).toBeCloseTo(day / 30, 10);
      expect(curveExpected(3000, "2026-09", {}, day)).toBeCloseTo(
        (3000 * day) / 30,
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

/**
 * The Plan editor's top-down cascade: total → reserve → platform shares →
 * objective shares. Shares are the primary state and amounts are derived, so
 * the properties that matter are (a) derived amounts always sum to their
 * parent, (b) editing the total is a pure rescale, and (c) a reserve transfer
 * moves money without disturbing anyone else's dollars.
 */
describe("planning cascade", () => {
  const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

  describe("reserve carved out of the total", () => {
    it("allocatable is the total minus the reserve", () => {
      expect(allocatableFromTotal(10_000, 1_500)).toBe(8_500);
      expect(allocatableFromTotal(10_000, 0)).toBe(10_000);
      // A reserve bigger than the total leaves nothing to allocate, not a
      // negative pot.
      expect(allocatableFromTotal(1_000, 5_000)).toBe(0);
    });

    it("converts between a reserve amount and a share of the total", () => {
      expect(reserveShare(1_500, 10_000)).toBeCloseTo(15, 6);
      expect(reserveShare(0, 10_000)).toBe(0);
      expect(reserveShare(100, 0)).toBeNull();
      expect(reserveFromShare(15, 10_000)).toBe(1_500);
      expect(reserveFromShare(12.5, 8_000)).toBe(1_000);
      // Out-of-range input clamps rather than producing nonsense.
      expect(reserveFromShare(150, 10_000)).toBe(10_000);
      expect(reserveFromShare(-5, 10_000)).toBe(0);
    });

    it("round-trips a reserve through its share", () => {
      const total = 12_345.67;
      const reserve = 2_000;
      expect(reserveFromShare(reserveShare(reserve, total)!, total)).toBeCloseTo(reserve, 2);
    });
  });

  describe("shares → amounts", () => {
    it("derived amounts sum to the parent, even on an awkward split", () => {
      const amounts = amountsFromShares(10_000, [33.3, 33.3, 33.4]);
      expect(sum(amounts)).toBe(10_000);
      const thirds = amountsFromShares(100, [33.33, 33.33, 33.34]);
      expect(sum(thirds)).toBe(100);
    });

    it("scales proportionally", () => {
      expect(amountsFromShares(1_000, [50, 30, 20])).toEqual([500, 300, 200]);
      expect(amountsFromShares(0, [50, 50])).toEqual([0, 0]);
    });

    it("an INCOMPLETE split places only what has been assigned", () => {
      // Mid-edit, one platform typed: it gets half the budget, not all of it.
      expect(amountsFromShares(10_000, [50, 0, 0, 0])).toEqual([5_000, 0, 0, 0]);
      // 80% assigned → $8,000 placed; the missing $2,000 is what the
      // 100%-or-no-save rule makes the planner deal with.
      expect(amountsFromShares(10_000, [50, 30])).toEqual([5_000, 3_000]);
      // Over-assigned overshoots rather than being quietly normalised back.
      expect(amountsFromShares(10_000, [60, 60])).toEqual([6_000, 6_000]);
    });

    it("changing the total is a pure rescale through the same shares", () => {
      const shares = [50, 30, 20];
      expect(amountsFromShares(10_000, shares)).toEqual([5_000, 3_000, 2_000]);
      // Double the budget: every platform keeps its share, so every amount
      // doubles — this is what "editing the total rescales everything" means.
      expect(amountsFromShares(20_000, shares)).toEqual([10_000, 6_000, 4_000]);
      expect(sum(amountsFromShares(7_777.77, shares))).toBe(7_777.77);
    });

    it("back-computes a share from a typed amount, holding the parent", () => {
      expect(shareFromAmount(2_500, 10_000)).toBe(25);
      expect(shareFromAmount(0, 10_000)).toBe(0);
      expect(shareFromAmount(100, 0)).toBe(0); // nothing to be a share OF
      // Full precision on purpose — rounding here would move other rows.
      expect(shareFromAmount(1_000, 3_000)).toBeCloseTo(33.3333333, 6);
    });

    it("a typed amount round-trips back to itself", () => {
      const parent = 8_500;
      const typed = 1_234.56;
      const share = shareFromAmount(typed, parent);
      const [derived] = amountsFromShares(parent, [share, 100 - share]);
      expect(derived).toBeCloseTo(typed, 2);
    });
  });

  describe("the 100% rule", () => {
    it("accepts a split that reaches 100 and rejects one that doesn't", () => {
      expect(sharesComplete([50, 30, 20])).toBe(true);
      expect(sharesComplete([33.3, 33.3, 33.4])).toBe(true);
      expect(sharesComplete([40, 45])).toBe(false); // 85% — 15% unassigned
      expect(sharesComplete([60, 50])).toBe(false); // over-assigned
      expect(sharesComplete([])).toBe(false);
    });

    it("accepts the full-precision shares a transfer produces", () => {
      // A transfer writes shares as amount ÷ allocatable, so they are long
      // decimals rather than the tidy numbers someone types.
      const amounts = [4_000, 2_400, 2_600];
      const allocatable = 9_000;
      const shares = amounts.map((a) => shareFromAmount(a, allocatable));
      expect(shares[0]).toBeCloseTo(44.4444444, 6);
      expect(sharesComplete(shares)).toBe(true);
      expect(sharesComplete([100 / 3, 100 / 3, 100 / 3])).toBe(true);
    });

    it("absorbs float dust but not a real gap", () => {
      // The epsilon exists for binary-addition dust, which is orders of
      // magnitude below a cent of share — not to wave through a 0.01% hole.
      expect(sharesComplete([50, 49.999_999])).toBe(true);
      expect(sharesComplete([50, 49.99])).toBe(false);
    });

    it("reports exactly how much is unassigned", () => {
      expect(shareRemainder([40, 45])).toBe(15);
      expect(shareRemainder([60, 50])).toBe(-10);
      expect(shareRemainder([100])).toBe(0);
    });

    it("distribute-evenly lands on exactly 100", () => {
      const fixed = distributeShareEvenly([40, 45]);
      expect(sum(fixed)).toBe(100);
      expect(sharesComplete(fixed)).toBe(true);
      expect(fixed).toEqual([47.5, 52.5]);

      // Three rows, indivisible remainder — still exactly 100.
      const thirds = distributeShareEvenly([0, 0, 0]);
      expect(sum(thirds)).toBe(100);
      expect(sharesComplete(thirds)).toBe(true);

      // Already complete: a no-op.
      expect(distributeShareEvenly([50, 50])).toEqual([50, 50]);
    });
  });

  describe("moving money", () => {
    // $10k total, $2k reserve → $8k allocatable split 50/30/20.
    const amounts = [4_000, 2_400, 1_600];
    const base = { amounts, reserve: 2_000, total: 10_000, allocatable: 8_000 };

    it("from the RESERVE: target rises, others keep their dollars", () => {
      const out = moveMoney({ ...base, toIndex: 2, amount: 1_000, source: { kind: "reserve" } })!;
      expect(out.amounts).toEqual([4_000, 2_400, 2_600]);
      expect(out.reserve).toBe(1_000);
      expect(out.total).toBe(10_000); // a move, not new money
      expect(out.allocatable).toBe(9_000);
      expect(amountsFromShares(out.allocatable, out.shares)).toEqual([4_000, 2_400, 2_600]);
      expect(sharesComplete(out.shares)).toBe(true);
    });

    it("from a PLATFORM: one falls, one rises, the pot is unchanged", () => {
      const out = moveMoney({
        ...base,
        toIndex: 2,
        amount: 1_000,
        source: { kind: "platform", index: 0 },
      })!;
      expect(out.amounts).toEqual([3_000, 2_400, 2_600]);
      expect(out.reserve).toBe(2_000); // untouched
      expect(out.total).toBe(10_000);
      expect(out.allocatable).toBe(8_000); // nothing entered or left the pot
      expect(amountsFromShares(out.allocatable, out.shares)).toEqual([3_000, 2_400, 2_600]);
      expect(sharesComplete(out.shares)).toBe(true);
    });

    it("from NEW MONEY: the total grows by the amount", () => {
      const out = moveMoney({ ...base, toIndex: 1, amount: 5_000, source: { kind: "new" } })!;
      expect(out.amounts).toEqual([4_000, 7_400, 1_600]);
      expect(out.reserve).toBe(2_000); // the reserve is not the source
      expect(out.total).toBe(15_000);
      expect(out.allocatable).toBe(13_000);
      expect(amountsFromShares(out.allocatable, out.shares)).toEqual([4_000, 7_400, 1_600]);
    });

    /**
     * The bug this pins (carried from the correctness pass): the editor derives
     * amounts as share × (total − reserve), which is only Σ amounts once a plan
     * is fully assigned. Deriving the post-move shares from Σ amounts instead
     * inflated the target — $400 + $100 became $900 on a half-assigned plan.
     */
    it("is exact MID-EDIT, when the split is still incomplete", () => {
      // Total $1,000, reserve $200 → allocatable $800, one platform at 50%.
      const partial = amountsFromShares(800, [50, 0, 0, 0]);
      expect(partial[0]).toBe(400);
      const args = { amounts: partial, reserve: 200, total: 1_000, allocatable: 800 };

      for (const source of [
        { kind: "reserve" } as const,
        { kind: "new" } as const,
      ]) {
        const out = moveMoney({ ...args, toIndex: 0, amount: 100, source })!;
        // Re-derive the way the editor does: share × (total − reserve).
        const rederived = amountsFromShares(out.total - out.reserve, out.shares);
        expect(rederived[0]).toBe(500); // moved by EXACTLY the $100
        expect(rederived[1]).toBe(0); // …and nobody else moved
        expect(rederived[2]).toBe(0);
        expect(rederived[3]).toBe(0);
      }
    });

    it("a platform-to-platform move is exact mid-edit too", () => {
      const partial = amountsFromShares(800, [50, 25, 0, 0]); // $400 / $200
      const out = moveMoney({
        amounts: partial,
        reserve: 200,
        total: 1_000,
        allocatable: 800,
        toIndex: 1,
        amount: 150,
        source: { kind: "platform", index: 0 },
      })!;
      const rederived = amountsFromShares(out.total - out.reserve, out.shares);
      expect(rederived[0]).toBe(250);
      expect(rederived[1]).toBe(350);
      expect(rederived[2]).toBe(0);
    });

    it("refuses moves it can't fund", () => {
      expect(moveMoney({ ...base, toIndex: 0, amount: 2_500, source: { kind: "reserve" } })).toBeNull();
      expect(
        moveMoney({ ...base, toIndex: 1, amount: 5_000, source: { kind: "platform", index: 0 } }),
      ).toBeNull(); // platform 0 only holds $4,000
      expect(moveMoney({ ...base, toIndex: 0, amount: 0, source: { kind: "new" } })).toBeNull();
      expect(moveMoney({ ...base, toIndex: 0, amount: -5, source: { kind: "new" } })).toBeNull();
      expect(moveMoney({ ...base, toIndex: 9, amount: 10, source: { kind: "new" } })).toBeNull();
      // Moving a platform onto itself is a no-op, not a silent identity.
      expect(
        moveMoney({ ...base, toIndex: 0, amount: 100, source: { kind: "platform", index: 0 } }),
      ).toBeNull();
    });

    it("can empty the reserve exactly", () => {
      const out = moveMoney({ ...base, toIndex: 1, amount: 2_000, source: { kind: "reserve" } })!;
      expect(out.reserve).toBe(0);
      expect(out.allocatable).toBe(10_000); // the whole total is allocated now
    });

    it("money is conserved unless it is explicitly new", () => {
      const moved = moveMoney({ ...base, toIndex: 0, amount: 750, source: { kind: "reserve" } })!;
      expect(round2(moved.allocatable + moved.reserve)).toBe(10_000);
      const added = moveMoney({ ...base, toIndex: 0, amount: 750, source: { kind: "new" } })!;
      expect(round2(added.allocatable + added.reserve)).toBe(10_750);
    });
  });

  describe("normalizeShares", () => {
    it("scales an incomplete split up to exactly 100, keeping proportions", () => {
      const out = normalizeShares([30, 20, 10]); // 3:2:1 of 60%
      expect(round2(out.reduce((s, v) => s + v, 0))).toBe(100);
      expect(out).toEqual([50, 33.33, 16.67]);
      expect(sharesComplete(out)).toBe(true);
    });

    it("scales an over-assigned split back down", () => {
      const out = normalizeShares([80, 40]); // 2:1 of 120%
      expect(out).toEqual([66.67, 33.33]);
      expect(sharesComplete(out)).toBe(true);
    });

    it("lands on exactly 100 where naive scaling would not", () => {
      const out = normalizeShares([1, 1, 1]);
      expect(round2(out.reduce((s, v) => s + v, 0))).toBe(100);
      expect(sharesComplete(out)).toBe(true);
    });

    it("leaves an already-complete split alone", () => {
      expect(normalizeShares([50, 30, 20])).toEqual([50, 30, 20]);
    });

    it("has nothing to scale when everything is zero", () => {
      expect(normalizeShares([0, 0])).toEqual([0, 0]);
      expect(normalizeShares([])).toEqual([]);
    });

    it("differs from distribute-evenly — scale vs pad", () => {
      // 3:1 of 80%. Scaling keeps the ratio; padding splits the gap equally.
      expect(normalizeShares([60, 20])).toEqual([75, 25]);
      expect(distributeShareEvenly([60, 20])).toEqual([70, 30]);
    });
  });

  describe("reconstructing shares from stored amounts", () => {
    it("round-trips a stored plan back to the same amounts", () => {
      // What the DB holds: per platform × objective amounts, plus the reserve.
      const stored = [3_500, 2_500, 1_500, 500];
      const reserve = 2_000;
      const allocatable = sum(stored);
      const total = round2(allocatable + reserve);
      expect(total).toBe(10_000);

      // Editing reconstructs the shares…
      const shares = stored.map((a) => shareFromAmount(a, allocatable));
      expect(sharesComplete(shares)).toBe(true);
      expect(reserveShare(reserve, total)).toBeCloseTo(20, 6);

      // …and deriving straight back gives the stored amounts, to the cent.
      expect(amountsFromShares(allocatable, shares)).toEqual(stored);
    });

    it("round-trips an awkward plan too", () => {
      const stored = [1_111.11, 2_222.22, 3_333.33, 1.01];
      const allocatable = sum(stored);
      const shares = stored.map((a) => shareFromAmount(a, allocatable));
      expect(amountsFromShares(allocatable, shares)).toEqual(stored);
      expect(sharesComplete(shares)).toBe(true);
    });
  });
});

/**
 * Pacing's URL guards. A hand-edited or stale link must degrade to the default
 * view, never reach Postgres as a bad date literal or ask for 120,000 months.
 */
describe("pacing range guards", () => {
  it("accepts real dates and rejects well-shaped impossible ones", () => {
    expect(isValidIsoDate("2026-09-10")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true); // leap year
    // Right shape, not a date — the regex alone would have let these through.
    expect(isValidIsoDate("2026-99-99")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2027-02-29")).toBe(false); // not a leap year
    expect(isValidIsoDate("2026-9-10")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
  });

  it("leaves a sane range alone", () => {
    expect(clampRangeMonths("2026-01-01", "2026-03-31")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("clamps an absurd span, keeping the recent end", () => {
    const { from, to } = clampRangeMonths("0001-01-01", "9999-12-31");
    expect(to).toBe("9999-12-31"); // the end anyone actually asked for
    expect(from).toBe("9997-01-01");
    // Measured by arithmetic — walking ~97k months to find out a range is too
    // long is exactly the cost the clamp exists to avoid.
    expect(monthSpan(from, to)).toBe(MAX_RANGE_MONTHS);
  });

  it("clamps to exactly the cap at the boundary", () => {
    // 36 months inclusive — right on the limit, so untouched.
    expect(clampRangeMonths("2024-01-01", "2026-12-31").from).toBe("2024-01-01");
    // 37 months — pulled up by one.
    const clamped = clampRangeMonths("2023-12-01", "2026-12-31");
    expect(monthsInRange(clamped.from, clamped.to)).toHaveLength(MAX_RANGE_MONTHS);
    expect(monthSpan(clamped.from, clamped.to)).toBe(MAX_RANGE_MONTHS);
    expect(clamped.from).toBe("2024-01-01");
  });
});

/**
 * A deviation you can't compute is NO verdict — never a warning. Dividing by a
 * zero plan (a spend plan with no revenue target, say) used to tint every row
 * warn off an Infinity.
 */
describe("pacing verdicts on non-finite input", () => {
  it("treats Infinity and NaN as muted, never warn", () => {
    expect(pacingTone(Infinity)).toBe("muted");
    expect(pacingTone(-Infinity)).toBe("muted");
    expect(pacingTone(NaN)).toBe("muted");
    expect(pacingTone(null)).toBe("muted");
    // …and a real miss still warns.
    expect(pacingTone(0.4)).toBe("warn");
  });

  it("renders the dash rather than 'Infinity% ahead'", () => {
    expect(pacingVerdict(Infinity)).toBe("—");
    expect(pacingVerdict(-Infinity)).toBe("—");
    expect(pacingVerdict(NaN)).toBe("—");
    expect(pacingVerdict(0.12)).toBe("12% ahead");
  });

  it("pacingDeviation itself never hands out a non-finite number", () => {
    expect(pacingDeviation(100, 0)).toBeNull();
    expect(pacingDeviation(Infinity, 100)).toBeNull();
    expect(pacingDeviation(NaN, 100)).toBeNull();
  });
});

/**
 * The save gate. 100%-or-no-save is deliberate — undecided money belongs in the
 * reserve — but a month planned only as a REVENUE TARGET has always been a
 * valid plan in storage, and the gate must not lock it out.
 */
describe("plan save gate", () => {
  const platform = (label: string, share: number, objectiveShares: number[]) => ({
    label,
    share,
    objectiveShares,
  });
  const complete = {
    total: 10_000,
    reserve: 1_000,
    hasRevenueTarget: true,
    platforms: [
      platform("Instagram", 60, [50, 50, 0, 0]),
      platform("TikTok", 40, [100, 0, 0, 0]),
    ],
  };

  it("passes a fully-assigned plan", () => {
    expect(planGateProblems(complete)).toEqual([]);
  });

  it("names the platform gap precisely", () => {
    const problems = planGateProblems({
      ...complete,
      platforms: [platform("Instagram", 60, [100, 0, 0, 0])],
    });
    expect(problems).toContain("Platform shares: 60.0% — 40.0% unassigned");
  });

  it("names the objective gap precisely, per platform", () => {
    const problems = planGateProblems({
      ...complete,
      platforms: [
        platform("Instagram", 60, [50, 50, 0, 0]),
        platform("Snapchat", 40, [85, 0, 0, 0]),
      ],
    });
    expect(problems).toEqual(["Snapchat objectives: 85.0% — 15.0% unassigned"]);
  });

  it("reports over-assignment as over, not as a gap", () => {
    const problems = planGateProblems({
      ...complete,
      platforms: [platform("Instagram", 60, [100, 0, 0, 0]), platform("TikTok", 60, [100, 0, 0, 0])],
    });
    expect(problems[0]).toBe("Platform shares: 120.0% — 20.0% over");
  });

  it("never blocks on a rounding artifact", () => {
    // Thirds: the split a planner reaches for and the one naive maths fails.
    expect(
      planGateProblems({
        ...complete,
        platforms: [
          platform("A", 33.3, [33.3, 33.3, 33.4, 0]),
          platform("B", 33.3, [100, 0, 0, 0]),
          platform("C", 33.4, [100, 0, 0, 0]),
        ],
      }),
    ).toEqual([]);
  });

  describe("a revenue target on its own", () => {
    it("is a valid plan with no spend budget", () => {
      expect(
        planGateProblems({
          total: 0,
          reserve: 0,
          hasRevenueTarget: true,
          platforms: [],
        }),
      ).toEqual([]);
    });

    it("still refuses a reserve, which is carved from a total", () => {
      expect(
        planGateProblems({
          total: 0,
          reserve: 500,
          hasRevenueTarget: true,
          platforms: [],
        }),
      ).toEqual(["A reserve needs a total budget to be carved out of."]);
    });

    it("an empty month asks for one or the other", () => {
      expect(
        planGateProblems({ total: 0, reserve: 0, hasRevenueTarget: false, platforms: [] }),
      ).toEqual(["Set a total budget, or just a revenue target."]);
    });
  });

  it("catches a reserve larger than the total", () => {
    expect(
      planGateProblems({ ...complete, total: 500, reserve: 1_000 }),
    ).toContain("The reserve is larger than the total budget.");
  });

  it("asks for a platform when a budget is set but nothing is split", () => {
    expect(
      planGateProblems({ ...complete, platforms: [] }),
    ).toEqual(["Give at least one platform a share."]);
  });
});

/**
 * The curve editor's bar chart plots each day's planned DOLLARS. It must be
 * the same number the pacing math uses — a chart that disagrees with the plan
 * it is drawing is worse than no chart.
 */
describe("per-day plan dollars (curve chart)", () => {
  it("bars are exactly monthDayIncrements", () => {
    const weights = { 10: 3, 25: 3 };
    const bars = monthDayIncrements("2026-09-01", weights, 100_000);
    expect(bars).toHaveLength(30);
    // 28 normal days at ×1 plus two at ×3 → 34 weight units.
    const unit = 100_000 / 34;
    expect(bars[0]).toBeCloseTo(unit, 6);
    expect(bars[9]).toBeCloseTo(unit * 3, 6); // day 10
    expect(bars[24]).toBeCloseTo(unit * 3, 6); // day 25
    expect(bars.reduce((s, v) => s + v, 0)).toBeCloseTo(100_000, 6);
  });

  it("weighting a day SHRINKS the others — the total never moves", () => {
    const flat = monthDayIncrements("2026-09-01", {}, 30_000);
    const weighted = monthDayIncrements("2026-09-01", { 10: 3 }, 30_000);
    expect(weighted[9]!).toBeGreaterThan(flat[9]!);
    expect(weighted[0]!).toBeLessThan(flat[0]!); // everyone else gives a little
    expect(weighted.reduce((s, v) => s + v, 0)).toBeCloseTo(30_000, 6);
  });

  it("falls back to shares of the plan when no total is set", () => {
    // With a total of 0 the bars are all zero, so the UI plots the normalized
    // WEIGHTS instead — same shape, labelled as percentages.
    expect(monthDayIncrements("2026-09-01", { 10: 3 }, 0).every((v) => v === 0)).toBe(true);
    const shares = monthDayIncrements("2026-09-01", { 10: 3 }, 100);
    expect(shares.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 6);
    expect(shares[9]).toBeCloseTo(300 / 32, 6); // 3 of 32 weight units, as a %
  });
});
