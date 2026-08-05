/**
 * Pure math for the Store → Reconciliation page. COUNTS ONLY — Δ compares store
 * order counts against platform-claimed conversion counts; there is deliberately
 * no revenue comparison anywhere (a standing product decision).
 */

/** Δ = store orders − platform-claimed conversions (signed). */
export function reconDelta(storeOrders: number, claimed: number): number {
  return storeOrders - claimed;
}

/**
 * Δ% = Δ / store orders. NULL when store orders = 0 (a percentage of zero is
 * undefined → the UI renders "—"), even if the platform claims conversions.
 */
export function reconDeltaPct(
  storeOrders: number,
  claimed: number,
): number | null {
  if (storeOrders === 0) return null;
  return (storeOrders - claimed) / storeOrders;
}

/** |Δ%| at/above this is a "large" discrepancy → warn-tinted. */
export const RECON_WARN_THRESHOLD = 0.25;

/**
 * Semantic tone for a Δ%: this is a DISCREPANCY MAGNITUDE, not good/bad — both
 * claimed>store and claimed<store are discrepancies — so large |Δ%| gets warn
 * tinting rather than green/red. NULL (store=0) is muted.
 */
export function reconDeltaTone(pct: number | null): "muted" | "warn" {
  if (pct === null) return "muted";
  return Math.abs(pct) >= RECON_WARN_THRESHOLD ? "warn" : "muted";
}

/**
 * Is `day` within the trailing 7-day attribution window of the ads data horizon
 * (the latest ads data day)? Such a day is "still attributing", so a store >
 * claimed gap there isn't necessarily a real discrepancy. Both args are ISO
 * `YYYY-MM-DD`; returns false when there's no horizon.
 */
export function isWithinAttributionLag(
  day: string,
  horizon: string | null,
): boolean {
  if (!horizon) return false;
  if (day > horizon) return false; // future of the horizon — not a lag day
  const dayMs = Date.parse(`${day}T00:00:00Z`);
  const horizonMs = Date.parse(`${horizon}T00:00:00Z`);
  if (Number.isNaN(dayMs) || Number.isNaN(horizonMs)) return false;
  const diffDays = Math.round((horizonMs - dayMs) / 86_400_000);
  return diffDays >= 0 && diffDays < 7;
}
