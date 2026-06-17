/**
 * Robust Y-axis bounds for time-series charts.
 *
 * A single anomaly spike makes an auto `[0, max]` axis squash the rest of the
 * data into a sliver. We fix the AXIS, never the data: cap the axis at the
 * Tukey fence (Q3 + k·IQR) — which sits just above the bulk — and only when the
 * true max is a genuine far-outlier (overshoots the fence by ≥50%). Well-behaved
 * or naturally-spread charts get `trimmed: false` and are left exactly as they
 * were. The real values stay in the data and tooltips; the spike clips at the
 * top edge when capped.
 */

/** Quantile of an ASCENDING-sorted array (linear interpolation). */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface RobustBound {
  /** True data max across all series. */
  max: number;
  /** Axis cap that excludes a far-outlier spike. Equals `max` when no outlier
   *  was found. */
  cap: number;
  /** Whether the true max is a far-outlier above the cap. */
  trimmed: boolean;
}

/**
 * Compute a robust upper bound for a set of chart values. `k` is the Tukey
 * multiplier (3 = far outliers only; least surprising default).
 */
export function robustUpperBound(values: number[], k = 3): RobustBound {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return { max: 0, cap: 0, trimmed: false };
  const max = Math.max(...v);
  // Too few points to estimate a distribution, or nothing positive → no trim.
  if (v.length < 5 || max <= 0) return { max, cap: max, trimmed: false };

  const sorted = [...v].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const fence = q3 + k * (q3 - q1);

  // Only trim when a genuine far-outlier overshoots the fence by ≥50%, so a
  // negligible overshoot or naturally-spread highs don't trigger a needless cap.
  if (!(fence > 0) || max <= fence * 1.5) {
    return { max, cap: max, trimmed: false };
  }
  return { max, cap: fence, trimmed: true };
}
