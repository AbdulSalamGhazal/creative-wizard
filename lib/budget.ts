/**
 * Pure math + month helpers for the Budget module. Standing decisions this
 * module encodes (do not "fix"):
 * - Spend is planned/actualized in USD; revenue is SAR only. The two currencies
 *   meet ONLY through the per-brand USD→SAR rate (ROAS-through-rate below).
 * - Pacing deviation is a MAGNITUDE (over- and under-pace are both deviations)
 *   — warn-tinted, never green/red good/bad. Same philosophy as Reconciliation.
 */

/** "2026-09" → "2026-09-01"; passes through a full ISO date's month. */
export function monthStartIso(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})/);
  if (!m) return month;
  return `${m[1]}-${m[2]}-01`;
}

/** The YYYY-MM key of an ISO date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Days in the month containing `monthIso` (first-of-month ISO). */
export function daysInMonth(monthIso: string): number {
  const [y, m] = monthIso.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Previous / next month keys ("2026-09" → "2026-08" / "2026-10"). */
export function prevMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return d.toISOString().slice(0, 7);
}
export function nextMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return d.toISOString().slice(0, 7);
}

/** "September 2026" (en-US, matching the app's pinned locale). */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Elapsed days of `month` as of `todayIso`, clamped to [0, daysInMonth].
 * Day 1 counts as 1 elapsed day (pacing assumes the day's spend is in flight).
 */
export function elapsedDaysInMonth(month: string, todayIso: string): number {
  const total = daysInMonth(monthStartIso(month));
  if (monthKey(todayIso) < month) return 0; // future month
  if (monthKey(todayIso) > month) return total; // past month
  return Math.min(total, Number(todayIso.slice(8, 10)));
}

/** Linear expected-to-date share of a monthly plan. */
export function pacingExpected(
  planned: number,
  elapsedDays: number,
  totalDays: number,
): number {
  if (totalDays <= 0) return 0;
  return (planned * elapsedDays) / totalDays;
}

/**
 * Pacing deviation = (actual − expected) / expected. NULL when there's nothing
 * expected yet (no plan, or day 0) — the UI renders "—" instead of a verdict.
 */
export function pacingDeviation(
  actual: number,
  expected: number,
): number | null {
  if (expected <= 0) return null;
  return (actual - expected) / expected;
}

/** |deviation| at/above this is a "large" pacing miss → strong warn tint. */
export const PACING_WARN_THRESHOLD = 0.15;

/** Tone for a pacing deviation — magnitude-based, like Reconciliation's Δ. */
export function pacingTone(deviation: number | null): "muted" | "warn" {
  if (deviation === null) return "muted";
  return Math.abs(deviation) >= PACING_WARN_THRESHOLD ? "warn" : "muted";
}

/** "on track" / "12% ahead" / "8% behind" (rounded, magnitude-worded). */
export function pacingVerdict(deviation: number | null): string {
  if (deviation === null) return "—";
  const pct = Math.round(Math.abs(deviation) * 100);
  if (pct === 0) return "on track";
  return `${pct}% ${deviation > 0 ? "ahead" : "behind"}`;
}

/** Variance = actual − planned (same currency as the inputs). */
export function variance(actual: number, planned: number): number {
  return actual - planned;
}

/** Variance % of plan; NULL when there is no plan (renders "—"). */
export function variancePct(actual: number, planned: number): number | null {
  if (planned === 0) return null;
  return (actual - planned) / planned;
}

/**
 * ROAS through the brand rate: revenue (SAR) ÷ (spend USD × rate). NULL when
 * spend is zero or the rate is unusable — the UI shows "—" plus a hint.
 * Computed through the rate REGARDLESS of the display-currency toggle.
 */
export function roasThroughRate(
  revenueSar: number,
  spendUsd: number,
  rate: number,
): number | null {
  if (spendUsd <= 0 || rate <= 0) return null;
  return revenueSar / (spendUsd * rate);
}

/** The rate must be a real positive number, capped at 100 (fat-finger guard). */
export function validateRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate <= 100;
}

/** Spend display conversion: USD natively, or ×rate when the toggle says SAR. */
export function spendInDisplayCurrency(
  usd: number,
  currency: "USD" | "SAR",
  rate: number,
): number {
  return currency === "SAR" ? usd * rate : usd;
}
