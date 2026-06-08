/**
 * Spearman rank correlation — the robust choice for ad metrics, which are
 * monotonic but not linear and have a few giant-spend outliers that would wreck
 * a Pearson coefficient. We rank each variable (averaging ties) and run Pearson
 * on the ranks. Inputs are pairwise-complete: the caller drops any pair where
 * either value is null/non-finite before passing it in.
 */

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Average-tie ranks (1-based). Ties share the mean of the ranks they span. */
function ranks(xs: number[]): number[] {
  const order = xs
    .map((v, i) => [v, i] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based average over the tied span
    for (let k = i; k <= j; k++) r[order[k]![1]] = avgRank;
    i = j + 1;
  }
  return r;
}

function pearson(xs: number[], ys: number[]): number | null {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  if (denom === 0) return null; // one variable is constant → undefined correlation
  return sxy / denom;
}

export interface Correlation {
  rho: number;
  n: number;
}

/**
 * Spearman ρ over pairwise-complete (x, y). Returns null when fewer than `minN`
 * complete pairs survive (too few to trust) or a variable has zero variance.
 */
export function spearman(
  pairs: Array<[number, number]>,
  minN = 6,
): Correlation | null {
  const clean = pairs.filter(
    ([a, b]) => Number.isFinite(a) && Number.isFinite(b),
  );
  const n = clean.length;
  if (n < minN) return null;
  const rho = pearson(
    ranks(clean.map((p) => p[0])),
    ranks(clean.map((p) => p[1])),
  );
  return rho === null ? null : { rho, n };
}
