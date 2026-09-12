import { describe, expect, it } from "vitest";
import { BUDGET_OBJECTIVES } from "@/lib/budget";
import {
  FUNNEL_STAGES,
  STAGE_SHORT,
  asOfLabel,
  averageKnownSize,
  carryForwardSeries,
  daysBetween,
  isFunnelStage,
  isStale,
  knownDays,
  pressure,
  stageLabel,
  stalenessDays,
} from "@/lib/audience";

describe("funnel stages derive from the budget buckets", () => {
  it("is the main buckets in order, with Other excluded", () => {
    expect(FUNNEL_STAGES).toEqual(BUDGET_OBJECTIVES.filter((o) => o !== "Other"));
    expect(FUNNEL_STAGES).toHaveLength(BUDGET_OBJECTIVES.length - 1);
    expect(isFunnelStage("Other")).toBe(false);
    expect(isFunnelStage("Awareness")).toBe(true);
    expect(isFunnelStage("Sales")).toBe(false);
  });

  it("labels every stage with both names", () => {
    for (const stage of FUNNEL_STAGES) {
      expect(STAGE_SHORT[stage]).toBeTruthy();
      expect(stageLabel(stage)).toBe(`${stage} · ${STAGE_SHORT[stage]}`);
    }
    expect(stageLabel("Awareness")).toBe("Awareness · TOF");
  });
});

describe("carry-forward (step, never interpolate)", () => {
  it("holds the last known value and never fills the gap", () => {
    const days = carryForwardSeries("2026-03-01", "2026-03-06", [
      { date: "2026-03-01", size: 1_000 },
      { date: "2026-03-05", size: 2_000 },
    ]);
    expect(days.map((d) => d.size)).toEqual([1_000, 1_000, 1_000, 1_000, 2_000, 2_000]);
    // The step happens ON the measurement day — no ramp through the gap.
    expect(days[3]!.size).toBe(1_000);
    expect(days.map((d) => d.asOf)).toEqual([
      "2026-03-01", "2026-03-01", "2026-03-01", "2026-03-01", "2026-03-05", "2026-03-05",
    ]);
    expect(days.map((d) => d.ageDays)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("is UNKNOWN before the first snapshot — never zero", () => {
    const days = carryForwardSeries("2026-03-01", "2026-03-04", [
      { date: "2026-03-03", size: 500 },
    ]);
    expect(days.map((d) => d.size)).toEqual([null, null, 500, 500]);
    expect(days[0]!.asOf).toBeNull();
    expect(days[0]!.ageDays).toBeNull();
    expect(knownDays(days)).toBe(2);
  });

  it("with no snapshots at all, every day is unknown", () => {
    const days = carryForwardSeries("2026-03-01", "2026-03-03", []);
    expect(days.map((d) => d.size)).toEqual([null, null, null]);
    expect(knownDays(days)).toBe(0);
    expect(averageKnownSize(days)).toBeNull();
  });

  it("seeds the range from a measurement taken BEFORE it", () => {
    // This is why the query layer fetches the latest snapshot before `from`:
    // without the seed these days would wrongly read unknown.
    const days = carryForwardSeries("2026-03-10", "2026-03-12", [
      { date: "2026-02-20", size: 800 },
    ]);
    expect(days.map((d) => d.size)).toEqual([800, 800, 800]);
    expect(days[0]!.ageDays).toBe(18);
  });

  it("takes the last snapshot when a day carries several, whatever order they arrive in", () => {
    const days = carryForwardSeries("2026-03-01", "2026-03-01", [
      { date: "2026-03-01", size: 300 },
      { date: "2026-02-28", size: 100 },
    ]);
    expect(days[0]!.size).toBe(300);
  });

  it("counts a zero MEASUREMENT as known — zero is a real audience size", () => {
    const days = carryForwardSeries("2026-03-01", "2026-03-02", [
      { date: "2026-03-01", size: 0 },
    ]);
    expect(days.map((d) => d.size)).toEqual([0, 0]);
    expect(knownDays(days)).toBe(2);
    expect(averageKnownSize(days)).toBe(0);
  });
});

describe("staleness", () => {
  it("counts whole days, across months and years", () => {
    expect(daysBetween("2026-03-01", "2026-03-08")).toBe(7);
    expect(daysBetween("2026-02-26", "2026-03-02")).toBe(4); // 2026 is not a leap year
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
    expect(stalenessDays("2026-03-09", "2026-03-12")).toBe(3);
  });

  it("never reports a negative age", () => {
    expect(stalenessDays("2026-03-20", "2026-03-12")).toBe(0);
  });

  it("tints only past the single threshold, and never for unknown", () => {
    expect(isStale(7)).toBe(false);
    expect(isStale(8)).toBe(true);
    expect(isStale(null)).toBe(false);
  });

  it("captions a size with its age", () => {
    expect(asOfLabel("2026-09-09", 3)).toBe("as of Sep 9 · 3d ago");
    expect(asOfLabel("2026-09-09", 0)).toBe("as of Sep 9 · today");
    expect(asOfLabel(null, null)).toBe("never measured");
  });
});

describe("pressure — spend per 1,000 audience, known days only", () => {
  it("is component sums, not a mean of daily ratios", () => {
    // Σspend 300 ÷ Σ(size/1000) 3 = 100. The mean of the two daily ratios
    // (100 and 100) agrees here; the next case is where they diverge.
    expect(pressure([
      { size: 1_000, spend: 100 },
      { size: 2_000, spend: 200 },
    ])).toBe(100);

    // Day one: $100 over 1,000. Day two: $100 over 9,000. Component sums give
    // 200 ÷ 10 = 20; a mean of ratios would say 55.6.
    expect(pressure([
      { size: 1_000, spend: 100 },
      { size: 9_000, spend: 100 },
    ])).toBe(20);
  });

  it("ignores days with no known audience entirely", () => {
    const withUnknown = pressure([
      { size: null, spend: 500 },
      { size: 1_000, spend: 100 },
    ]);
    // The $500 spent on the unknown day is NOT smuggled into the ratio.
    expect(withUnknown).toBe(100);
  });

  it("is null when nothing is known, and when the known audience is zero", () => {
    expect(pressure([])).toBeNull();
    expect(pressure([{ size: null, spend: 100 }])).toBeNull();
    expect(pressure([{ size: 0, spend: 100 }])).toBeNull(); // never Infinity
  });

  it("is zero when a known audience got no spend", () => {
    expect(pressure([{ size: 5_000, spend: 0 }])).toBe(0);
  });

  it("averages the known sizes for the comparison table", () => {
    const days = carryForwardSeries("2026-03-01", "2026-03-04", [
      { date: "2026-03-02", size: 1_000 },
      { date: "2026-03-04", size: 2_000 },
    ]);
    // Unknown, 1000, 1000, 2000 → mean of the three known days.
    expect(averageKnownSize(days)).toBe(1_333);
  });
});
