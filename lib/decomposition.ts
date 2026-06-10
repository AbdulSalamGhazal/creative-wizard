/**
 * Mix vs Rate decomposition (Kitagawa, additive/MECE) for a campaign's weighted
 * ROAS between a prior period (A) and a current period (B).
 *
 * The change in blended ROAS splits exactly into:
 *   • mix  — budget share shifting across creatives (same creatives, different
 *            spend weights),
 *   • rate — each creative's own ROAS changing.
 *
 * We use the SYMMETRIC form (average of the two attribution orders), which is
 * order-independent and reconciles exactly: `mix + rate === roasB − roasA`
 * (asserted in the tests). A naive one-directional waterfall does NOT reconcile
 * and is order-dependent — do not use it (see spec §8).
 */

export interface PeriodCreative {
  id: string;
  name: string;
  spend: number;
  rev: number;
}

export interface BridgeContrib {
  id: string;
  name: string;
  mix: number;
  rate: number;
  total: number;
}

export interface BridgeResult {
  roasA: number;
  roasB: number;
  delta: number;
  mix: number;
  rate: number;
  /** Per-creative mix+rate contribution to the change, sorted by |total| desc. */
  contrib: BridgeContrib[];
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Decompose ΔROAS between prior (A) and current (B) into mix + rate effects.
 * A creative absent in one period contributes 0 to that period's blended ROAS
 * (its share is 0), but its per-creative rate falls back to the other period's
 * value so the split reads as a pure mix move rather than a spurious rate swing.
 */
export function mixRateDecomposition(
  A: PeriodCreative[],
  B: PeriodCreative[],
): BridgeResult {
  const aById = new Map(A.map((c) => [c.id, c]));
  const bById = new Map(B.map((c) => [c.id, c]));

  const totalSpendA = sum(A.map((c) => c.spend));
  const totalSpendB = sum(B.map((c) => c.spend));
  const totalRevA = sum(A.map((c) => c.rev));
  const totalRevB = sum(B.map((c) => c.rev));

  const roasA = totalSpendA > 0 ? totalRevA / totalSpendA : 0;
  const roasB = totalSpendB > 0 ? totalRevB / totalSpendB : 0;

  const ids = new Set<string>([...aById.keys(), ...bById.keys()]);
  let mix = 0;
  let rate = 0;
  const contrib: BridgeContrib[] = [];

  for (const id of ids) {
    const a = aById.get(id);
    const b = bById.get(id);
    const name = b?.name ?? a?.name ?? id;

    const spendA = a?.spend ?? 0;
    const spendB = b?.spend ?? 0;
    const shareA = totalSpendA > 0 ? spendA / totalSpendA : 0;
    const shareB = totalSpendB > 0 ? spendB / totalSpendB : 0;

    // Per-creative own ROAS; absent in a period ⇒ borrow the other period's
    // rate so the move attributes to mix, not a phantom rate change.
    const ownA = spendA > 0 ? (a!.rev / spendA) : null;
    const ownB = spendB > 0 ? (b!.rev / spendB) : null;
    const rA = ownA ?? ownB ?? 0;
    const rB = ownB ?? ownA ?? 0;

    const mixI = (shareB - shareA) * ((rA + rB) / 2);
    const rateI = (rB - rA) * ((shareA + shareB) / 2);
    mix += mixI;
    rate += rateI;
    contrib.push({ id, name, mix: mixI, rate: rateI, total: mixI + rateI });
  }

  contrib.sort((x, y) => Math.abs(y.total) - Math.abs(x.total));

  return { roasA, roasB, delta: roasB - roasA, mix, rate, contrib };
}
