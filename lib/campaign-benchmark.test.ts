import { describe, expect, it } from "vitest";
import {
  benchmarkBand,
  expectedRoas,
  performanceIndex,
  type BenchmarkWeek,
} from "./campaign-benchmark";

describe("expectedRoas", () => {
  it("spend-weights peer ROAS across the campaign's active weeks", () => {
    // Week1: peer ROAS 2.0, campaign spent 100. Week2: peer ROAS 4.0, campaign
    // spent 300. expected = (2*100 + 4*300) / 400 = 1400/400 = 3.5
    const weeks: BenchmarkWeek[] = [
      { campaignSpend: 100, peerSpend: 1000, peerRev: 2000 },
      { campaignSpend: 300, peerSpend: 1000, peerRev: 4000 },
    ];
    expect(expectedRoas(weeks)).toBeCloseTo(3.5, 9);
  });

  it("ignores weeks with no campaign spend and guards zero peer spend", () => {
    const weeks: BenchmarkWeek[] = [
      { campaignSpend: 0, peerSpend: 1000, peerRev: 9999 }, // ignored
      { campaignSpend: 200, peerSpend: 0, peerRev: 0 }, // peer ROAS → 0
      { campaignSpend: 200, peerSpend: 100, peerRev: 300 }, // peer ROAS 3
    ];
    // expected = (0*200 + 3*200) / 400 = 1.5
    expect(expectedRoas(weeks)).toBeCloseTo(1.5, 9);
  });

  it("returns 0 with no campaign spend", () => {
    expect(expectedRoas([{ campaignSpend: 0, peerSpend: 1, peerRev: 1 }])).toBe(0);
  });
});

describe("performanceIndex", () => {
  it("an on-baseline campaign indexes ≈ 100", () => {
    expect(performanceIndex(2.0, 2.0)).toBe(100);
  });
  it("scales linearly", () => {
    expect(performanceIndex(2.38, 1.97)).toBe(121); // the spec's reference figure
    expect(performanceIndex(1.0, 2.0)).toBe(50);
  });
  it("guards a zero baseline", () => {
    expect(performanceIndex(3, 0)).toBe(0);
  });
});

describe("benchmarkBand", () => {
  it("bands relative to expected", () => {
    expect(benchmarkBand(0.8, 1.0)).toBe("under"); // 0.80×
    expect(benchmarkBand(1.0, 1.0)).toBe("on-par"); // 1.00×
    expect(benchmarkBand(1.1, 1.0)).toBe("on-par"); // 1.10×
    expect(benchmarkBand(1.2, 1.0)).toBe("above"); // 1.20×
  });
});
