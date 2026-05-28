/**
 * Period math for period-over-period comparisons.
 *
 * Every Trends surface compares a "current" window to its immediately
 * preceding window of equal length. We keep this in one place so the math is
 * consistent across every query and tile.
 *
 * All dates are ISO `YYYY-MM-DD` strings — we work in UTC and never depend
 * on the runtime's local timezone.
 */

/** Inclusive day count of an ISO range. dayCount("2026-05-01", "2026-05-07") === 7. */
export function dayCount(from: string, to: string): number {
  const f = Date.parse(from + "T00:00:00Z");
  const t = Date.parse(to + "T00:00:00Z");
  if (Number.isNaN(f) || Number.isNaN(t)) return 0;
  return Math.round((t - f) / 86_400_000) + 1;
}

/**
 * For an inclusive `[from, to]` range, return the immediately preceding
 * inclusive range of equal length. e.g. last 30d → prior 30d.
 */
export function prevPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const len = dayCount(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return { from: prevFrom, to: prevTo };
}

/** Add N days to an ISO date (UTC). N may be negative. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type DeltaMode = "pct" | "new" | "removed" | "absent";

export interface Delta {
  /** Relative percent change, e.g. 0.183 means +18.3%. null when mode !== "pct". */
  pct: number | null;
  mode: DeltaMode;
}

/**
 * Compute a comparison delta between two non-negative magnitudes. Caller
 * decides whether ↑ is "good" or "bad" — that's a presentation concern,
 * not a math one.
 *
 * Edge cases:
 *   prev === null && curr === null  → absent  (no signal either side)
 *   prev === 0    && curr  >  0     → new     (no baseline, show a "New" chip)
 *   prev  >  0    && curr === 0     → removed (-100%, but flag explicitly)
 *   prev === 0    && curr === 0     → absent
 *   prev === null && curr  >  0     → new
 */
export function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
): Delta {
  const c = current ?? null;
  const p = previous ?? null;
  if (c === null && p === null) return { pct: null, mode: "absent" };
  if ((p === null || p === 0) && c !== null && c > 0) {
    return { pct: null, mode: "new" };
  }
  if ((c === null || c === 0) && p !== null && p > 0) {
    return { pct: -1, mode: "removed" };
  }
  if (p === null || p === 0 || c === null) return { pct: null, mode: "absent" };
  return { pct: (c - p) / p, mode: "pct" };
}

/**
 * For the few places that want a labeled "vs prior X" caption ("vs prior 30d",
 * "vs prior 7d", "vs prior 5mo" past 60d).
 */
export function periodCaption(from: string, to: string): string {
  const n = dayCount(from, to);
  if (n <= 0) return "vs prior period";
  if (n < 60) return `vs prior ${n}d`;
  const months = Math.round(n / 30);
  return `vs prior ${months}mo`;
}
