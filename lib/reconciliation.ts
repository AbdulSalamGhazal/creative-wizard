/**
 * Pure math for the Store → Reconciliation page. COUNTS ONLY — Δ compares store
 * order counts against platform-claimed conversion counts; there is deliberately
 * no revenue comparison anywhere (a standing product decision).
 *
 * DIRECTION — the INFLATION framing, a user decision of 2026-09-19 that
 * SUPERSEDES the original store − claimed: **Δ = claimed − store**, so a
 * POSITIVE Δ means platforms claim MORE than the store actually recorded.
 * Actual 80, claimed 100 → Δ = +20, Δ% = +25%. Don't "fix" the sign back.
 */

/** Δ = platform-claimed conversions − store orders (signed; + = over-claim). */
export function reconDelta(storeOrders: number, claimed: number): number {
  return claimed - storeOrders;
}

/**
 * Δ% = Δ / store orders — the STORE side stays the base (what actually
 * happened is what an over-claim is measured against). NULL when store orders
 * = 0 (a percentage of zero is undefined → the UI renders "—"), even if the
 * platform claims conversions.
 */
export function reconDeltaPct(
  storeOrders: number,
  claimed: number,
): number | null {
  if (storeOrders === 0) return null;
  return (claimed - storeOrders) / storeOrders;
}

/**
 * Match rate = claimed / store orders ("platforms claim X% of your orders").
 * NULL when store orders = 0 (undefined → the UI renders "—"). Can exceed 1
 * when platforms over-claim — that's signal, not an error; don't clamp.
 */
export function reconMatchRate(
  storeOrders: number,
  claimed: number,
): number | null {
  if (storeOrders === 0) return null;
  return claimed / storeOrders;
}

/**
 * Share of a day's store orders that carry no attributable source — "how much
 * of this day has no UTM". NULL when the store recorded nothing that day (a
 * share of zero is undefined → the UI renders "—", never 0%).
 */
export function unattributedShare(
  unattributed: number,
  storeTotal: number,
): number | null {
  if (storeTotal === 0) return null;
  return unattributed / storeTotal;
}

export interface PlatformDayRow {
  storeByPlatform: Record<string, number>;
  claimedByPlatform: Record<string, number>;
  unattributed: number;
  storeOrders: number;
}

export interface PlatformTotals {
  store: Record<string, number>;
  claimed: Record<string, number>;
  unattributed: number;
  storeOrders: number;
}

/**
 * Range totals for the Platforms table: COMPONENT SUMS per platform, never an
 * average of per-day figures. The totals row's Δ and Δ% are then computed FROM
 * these sums (the house aggregation rule — a mean of daily ratios would be a
 * different, wrong number).
 */
export function sumPlatformDays<P extends string>(
  rows: readonly PlatformDayRow[],
  platforms: readonly P[],
): PlatformTotals {
  const store: Record<string, number> = {};
  const claimed: Record<string, number> = {};
  // Seeded up front so EVERY known platform has a bucket even when no row
  // mentions it — the table renders a column per platform regardless.
  for (const p of platforms) {
    store[p] = 0;
    claimed[p] = 0;
  }
  let unattributed = 0;
  let storeOrders = 0;
  for (const r of rows) {
    for (const p of platforms) {
      store[p] = (store[p] ?? 0) + (r.storeByPlatform[p] ?? 0);
      claimed[p] = (claimed[p] ?? 0) + (r.claimedByPlatform[p] ?? 0);
    }
    unattributed += r.unattributed;
    storeOrders += r.storeOrders;
  }
  return { store, claimed, unattributed, storeOrders };
}

/** |Δ%| at/above this is a "large" discrepancy → warn-tinted. */
export const RECON_WARN_THRESHOLD = 0.25;

/**
 * Semantic tone for a Δ%: this is a DISCREPANCY MAGNITUDE, not good/bad — both
 * claimed>store and claimed<store are discrepancies — so large |Δ%| gets warn
 * tinting rather than green/red. Magnitude-based, so the 2026-09-19 sign flip
 * left it untouched. NULL (store=0) is muted.
 */
export function reconDeltaTone(pct: number | null): "muted" | "warn" {
  if (pct === null) return "muted";
  return Math.abs(pct) >= RECON_WARN_THRESHOLD ? "warn" : "muted";
}

/**
 * Is `day` within the trailing 7-day attribution window of the ads data horizon
 * (the latest ads data day)? Such a day is "still attributing": the platforms
 * haven't finished counting, so claimed runs LOW and a NEGATIVE Δ (claimed
 * under store) there isn't necessarily a real discrepancy. Both args are ISO
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
