/**
 * "Nice" axis ticks for the module's bullet rows and the ROAS ladder: round
 * steps (1 · 2 · 5 × 10ⁿ) covering every finite value handed in. Infinite
 * values are left out and clamp to the ends when drawn.
 */
export interface Axis {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

export function niceAxis(values: readonly number[], targetTicks = 5): Axis {
  const finite = values.filter((v) => Number.isFinite(v));
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 1;
  if (hi === lo) {
    hi = lo === 0 ? 1 : lo + Math.abs(lo) * 0.25;
    lo = lo === 0 ? 0 : lo - Math.abs(lo) * 0.25;
  }
  const rough = (hi - lo) / Math.max(1, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const step = (frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10) * pow;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return { min, max, step, ticks };
}

/** Where a value sits on an axis, 0–1, with ±∞ at the ends. */
export function axisPosition(axis: Axis, value: number): number {
  if (value === Infinity) return 1;
  if (value === -Infinity || Number.isNaN(value)) return 0;
  const span = axis.max - axis.min || 1;
  return Math.min(1, Math.max(0, (value - axis.min) / span));
}
