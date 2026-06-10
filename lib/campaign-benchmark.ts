/**
 * Within-audience expected ROAS + Performance Index (spec §2.1).
 *
 * "Good" is contextual, so we benchmark a campaign against its PEERS on the
 * SAME platform across the SAME weeks (the campaign itself excluded), weighted
 * by the campaign's own weekly spend. Never a global "good ROAS" number, and
 * never cross-platform (see spec §8).
 */

export interface BenchmarkWeek {
  /** This campaign's spend in the week (the weighting). */
  campaignSpend: number;
  /** Peer spend (same platform, same week, campaign subtracted out). */
  peerSpend: number;
  /** Peer conversion value. */
  peerRev: number;
}

/**
 * expected = Σ_w (peerRev_w / peerSpend_w) · campaignSpend_w  /  Σ_w campaignSpend_w
 * i.e. what ROAS the campaign's spend "should" have earned at peer rates, in the
 * weeks it actually spent. Returns 0 when there's no campaign spend.
 */
export function expectedRoas(weeks: BenchmarkWeek[]): number {
  let num = 0;
  let den = 0;
  for (const w of weeks) {
    if (w.campaignSpend <= 0) continue;
    const peerRoas = w.peerSpend > 0 ? w.peerRev / w.peerSpend : 0;
    num += peerRoas * w.campaignSpend;
    den += w.campaignSpend;
  }
  return den > 0 ? num / den : 0;
}

/** index = round(campaignRoas / expected · 100). 100 = exactly on baseline.
 *  Returns 0 when there's no usable peer baseline (expected ≤ 0). */
export function performanceIndex(campaignRoas: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.round((campaignRoas / expected) * 100);
}

export type BenchmarkBand = "under" | "on-par" | "above";

/** Band relative to the expected baseline: under < 0.85×, on-par 0.85–1.15×,
 *  above > 1.15×. */
export function benchmarkBand(
  campaignRoas: number,
  expected: number,
): BenchmarkBand {
  if (expected <= 0) return "on-par";
  const r = campaignRoas / expected;
  if (r < 0.85) return "under";
  if (r > 1.15) return "above";
  return "on-par";
}
