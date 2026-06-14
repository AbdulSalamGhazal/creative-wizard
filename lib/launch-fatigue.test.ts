import { describe, expect, it } from "vitest";
import {
  assessFatigue,
  deriveWindowMetrics,
  FATIGUE_WINDOWS,
  windowState,
  type FatigueWindowSums,
} from "@/lib/launch-fatigue";

function win(p: Partial<FatigueWindowSums>): FatigueWindowSums {
  return {
    spend: 0,
    conversionValue: 0,
    clicks: 0,
    impressions: 0,
    conversions: 0,
    landingPageViews: 0,
    ...p,
  };
}

/** A window with a target ROAS via component sums. */
function w(spend: number, roas: number, extra: Partial<FatigueWindowSums> = {}) {
  return win({ spend, conversionValue: spend * roas, ...extra });
}

describe("deriveWindowMetrics", () => {
  it("recombines ratios from sums", () => {
    const m = deriveWindowMetrics(
      win({
        spend: 1000,
        conversionValue: 4000,
        clicks: 2000,
        impressions: 100_000,
        conversions: 100,
        landingPageViews: 1600,
      }),
    );
    expect(m.roas).toBeCloseTo(4);
    expect(m.ctr).toBeCloseTo(0.02);
    expect(m.cpa).toBeCloseTo(10);
    expect(m.cvr).toBeCloseTo(0.0625);
    expect(m.hasData).toBe(true);
  });

  it("null ratios when the denominator is zero", () => {
    const m = deriveWindowMetrics(win({ conversionValue: 500 }));
    expect(m.roas).toBeNull();
    expect(m.hasData).toBe(false);
  });
});

describe("assessFatigue", () => {
  it("flags a ≥30% ROAS decay to the latest window as fatigued", () => {
    // launch week 9×, days 8–30 6×, days 31–90 3× → drop vs latest = 66.7%
    const a = assessFatigue(w(1000, 9), w(3000, 6), w(5000, 3));
    expect(a.tier).toBe("fatigued");
    expect(a.latestWindow).toBe(3);
    expect(a.drop).toBeCloseTo(1 - 3 / 9);
  });

  it("uses the latest window WITH spend as the endpoint (paused after day 30)", () => {
    const a = assessFatigue(w(1000, 9), w(3000, 5), win({}));
    expect(a.latestWindow).toBe(2);
    expect(a.tier).toBe("fatigued"); // 9 → 5 = 44% drop
    expect(a.drop).toBeCloseTo(1 - 5 / 9);
  });

  it("holds when ROAS barely moves", () => {
    const a = assessFatigue(w(1000, 8), w(3000, 7.5), w(5000, 7.4));
    expect(a.tier).toBe("holding");
  });

  it("flags a rising ROAS as improving", () => {
    const a = assessFatigue(w(1000, 6), w(3000, 7), w(5000, 8));
    expect(a.tier).toBe("improving");
    expect(a.drop).toBeLessThan(0);
  });

  it("is 'new' when only the launch week has spend", () => {
    const a = assessFatigue(w(1000, 9), win({}), win({}));
    expect(a.tier).toBe("new");
    expect(a.latestWindow).toBe(1);
    expect(a.drop).toBeNull();
  });

  it("is 'new' when the launch week has no ROAS to anchor on", () => {
    const a = assessFatigue(win({ spend: 1000 }), w(3000, 6), w(5000, 5));
    expect(a.tier).toBe("new");
    expect(a.drop).toBeNull();
  });

  it("never judges below the spend floor", () => {
    const a = assessFatigue(w(40, 9), w(40, 2), w(30, 1));
    expect(a.tier).toBe("low");
    expect(a.drop).toBeNull();
  });
});

describe("windowState", () => {
  const w3 = FATIGUE_WINDOWS[2]; // days 31–90 → startDay 30, endDay 89

  it("is not_started before the window's first day", () => {
    expect(windowState(22, w3.startDay, w3.endDay)).toBe("not_started");
  });

  it("is in_progress once the window has begun but not fully elapsed", () => {
    expect(windowState(45, w3.startDay, w3.endDay)).toBe("in_progress");
    // The boundary days count as in-progress (inclusive on both ends).
    expect(windowState(30, w3.startDay, w3.endDay)).toBe("in_progress");
    expect(windowState(89, w3.startDay, w3.endDay)).toBe("in_progress");
  });

  it("is complete once the whole window is in the past", () => {
    expect(windowState(90, w3.startDay, w3.endDay)).toBe("complete");
  });
});
