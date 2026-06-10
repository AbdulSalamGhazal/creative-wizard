/**
 * Within-campaign winners/losers + money-left-on-the-table (spec §2.3).
 *
 * Benchmarks each creative against THIS campaign's own blended ROAS — purely
 * internal, no cross-campaign comparison. Quantifies the revenue the losing
 * creatives left on the table under two counterfactuals:
 *   • floor — if the losers had merely matched the campaign average,
 *   • ceil  — if the losers had matched the campaign's own best creatives (topQ).
 */

export interface GapCreative {
  id: string;
  name: string;
  spend: number;
  rev: number;
}

export interface GapRow extends GapCreative {
  roas: number;
  /** ROAS below the campaign average. */
  isLoser: boolean;
  /** Below the spend threshold → a lucky tiny creative shouldn't read as a
   *  "winner"; render muted and keep it out of the topQ benchmark. */
  lowConfidence: boolean;
}

export interface GapResult {
  campaignAvg: number;
  /** Blended ROAS of the campaign's best creatives (≥ campaignAvg). */
  topQ: number;
  rows: GapRow[];
  loserSpend: number;
  loserRev: number;
  loserCount: number;
  /** Revenue gap if losers had matched the campaign average. */
  floorMissed: number;
  /** Revenue gap if losers had matched the campaign's best (topQ). */
  ceilMissed: number;
}

/** Creatives below this spend are statistically noisy — flagged low-confidence
 *  and excluded from the "best" used for the ceiling. */
export const LOW_CONFIDENCE_SPEND = 150;

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export function campaignGap(creatives: GapCreative[]): GapResult {
  const totalSpend = sum(creatives.map((c) => c.spend));
  const totalRev = sum(creatives.map((c) => c.rev));
  const campaignAvg = totalSpend > 0 ? totalRev / totalSpend : 0;

  const rows: GapRow[] = creatives
    .map((c) => {
      const roas = c.spend > 0 ? c.rev / c.spend : 0;
      return {
        ...c,
        roas,
        isLoser: roas < campaignAvg,
        lowConfidence: c.spend < LOW_CONFIDENCE_SPEND,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const losers = rows.filter((r) => r.isLoser);
  const loserSpend = sum(losers.map((r) => r.spend));
  const loserRev = sum(losers.map((r) => r.rev));

  // topQ = blended ROAS of the best creatives (desc by ROAS) until they cover
  // 25% of campaign spend. Low-confidence creatives don't qualify as "best".
  let acc = 0;
  let tqS = 0;
  let tqR = 0;
  const eligible = rows
    .filter((r) => !r.lowConfidence)
    .sort((a, b) => b.roas - a.roas);
  for (const c of eligible) {
    if (acc >= totalSpend * 0.25) break;
    tqS += c.spend;
    tqR += c.rev;
    acc += c.spend;
  }
  // Clamp to ≥ campaignAvg so the "best" counterfactual is never worse than the
  // average one — this keeps floorMissed ≤ ceilMissed by construction.
  const topQ = Math.max(tqS > 0 ? tqR / tqS : campaignAvg, campaignAvg);

  const floorMissed = Math.max(0, loserSpend * campaignAvg - loserRev);
  const ceilMissed = Math.max(0, loserSpend * topQ - loserRev);

  return {
    campaignAvg,
    topQ,
    rows,
    loserSpend,
    loserRev,
    loserCount: losers.length,
    floorMissed,
    ceilMissed,
  };
}
