/**
 * Pure launch-fatigue logic for Trends → Launches.
 *
 * Each creative is measured over three SEPARATE windows anchored to its own
 * launch day (day 0 = launch): days 1–7 (launch week), 8–30, 31–90. Ratios are
 * recombined here from component sums (weighted, never an average of per-row
 * ratios). "Fatigue" = the ROAS drop from the launch week to the latest window
 * that still has spend — so a creative whose efficiency decays as the audience
 * saturates is flagged, while a steady or improving one is not.
 */

export interface FatigueWindowSums {
  spend: number;
  conversionValue: number;
  clicks: number;
  impressions: number;
  conversions: number;
  landingPageViews: number;
}

export interface FatigueWindowMetrics {
  spend: number;
  roas: number | null;
  ctr: number | null;
  cpa: number | null;
  cvr: number | null;
  hasData: boolean;
}

export type FatigueTier = "fatigued" | "improving" | "holding" | "new" | "low";

export interface FatigueAssessment {
  w1: FatigueWindowMetrics;
  w2: FatigueWindowMetrics;
  w3: FatigueWindowMetrics;
  tier: FatigueTier;
  /** ROAS deterioration, launch week → latest window with spend (>0 = worse).
   *  Null when it can't be computed (too new / no later window / no launch-week ROAS). */
  drop: number | null;
  /** Index (1|2|3) of the latest window with spend — the decay endpoint. */
  latestWindow: 1 | 2 | 3 | null;
}

/** Fatigued if ROAS fell ≥30% by the latest window; improving if it rose ≥15%. */
export const FATIGUE_DROP = 0.3;
export const FATIGUE_IMPROVE = 0.15;
/** Below this lifetime (3-window) spend, ratios swing too wildly to judge. */
export const FATIGUE_SPEND_FLOOR = 150;

/**
 * The three measurement windows, in days SINCE launch (day 0 = launch day).
 * The single source of truth for both the SQL aggregation (db/queries/
 * performance.ts) and the UI — keep them deriving from this so they can't drift.
 * `endDay` is inclusive; the SQL also caps the join at the last window's endDay.
 */
export const FATIGUE_WINDOWS = [
  { key: "w1", label: "Days 1–7", short: "Launch wk", startDay: 0, endDay: 6 },
  { key: "w2", label: "Days 8–30", short: "Days 8–30", startDay: 7, endDay: 29 },
  { key: "w3", label: "Days 31–90", short: "Days 31–90", startDay: 30, endDay: 89 },
] as const;

export type FatigueWindowKey = (typeof FATIGUE_WINDOWS)[number]["key"];

/**
 * Where a creative stands relative to one window, given its age (days since
 * launch). `not_started` = the window's days haven't elapsed yet; `in_progress`
 * = the window has begun but isn't fully elapsed (so its ROAS is partial);
 * `complete` = the whole window is in the past. Lets the table distinguish
 * "too young to have run yet" from "ran but spent nothing here (paused/off)".
 */
export type WindowState = "not_started" | "in_progress" | "complete";

export function windowState(
  daysSinceLaunch: number,
  startDay: number,
  endDay: number,
): WindowState {
  if (daysSinceLaunch < startDay) return "not_started";
  if (daysSinceLaunch <= endDay) return "in_progress";
  return "complete";
}

/** Worst (most fatigued) first; positive news last. */
export const FATIGUE_TIER_ORDER: Record<FatigueTier, number> = {
  fatigued: 0,
  holding: 1,
  new: 2,
  improving: 3,
  low: 4,
};

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function deriveWindowMetrics(s: FatigueWindowSums): FatigueWindowMetrics {
  return {
    spend: s.spend,
    roas: ratio(s.conversionValue, s.spend),
    ctr: ratio(s.clicks, s.impressions),
    cpa: ratio(s.spend, s.conversions),
    cvr: ratio(s.conversions, s.landingPageViews),
    hasData: s.spend > 0,
  };
}

export function assessFatigue(
  w1s: FatigueWindowSums,
  w2s: FatigueWindowSums,
  w3s: FatigueWindowSums,
): FatigueAssessment {
  const w1 = deriveWindowMetrics(w1s);
  const w2 = deriveWindowMetrics(w2s);
  const w3 = deriveWindowMetrics(w3s);
  const base = { w1, w2, w3 };

  const totalSpend = w1s.spend + w2s.spend + w3s.spend;
  if (totalSpend < FATIGUE_SPEND_FLOOR) {
    return { ...base, tier: "low", drop: null, latestWindow: null };
  }

  const latestWindow: 1 | 2 | 3 | null = w3.hasData
    ? 3
    : w2.hasData
      ? 2
      : w1.hasData
        ? 1
        : null;

  if (latestWindow === null) {
    return { ...base, tier: "low", drop: null, latestWindow: null };
  }

  const latestRoas = latestWindow === 3 ? w3.roas : latestWindow === 2 ? w2.roas : w1.roas;

  // Need the launch-week anchor AND a later window to measure any decay. A zero
  // launch-week ROAS (spent, no revenue) can't anchor a % change either.
  if (latestWindow === 1 || w1.roas === null || w1.roas <= 0 || latestRoas === null) {
    return { ...base, tier: "new", drop: null, latestWindow };
  }

  const drop = (w1.roas - latestRoas) / w1.roas;
  const tier: FatigueTier =
    drop >= FATIGUE_DROP ? "fatigued" : drop <= -FATIGUE_IMPROVE ? "improving" : "holding";

  return { ...base, tier, drop, latestWindow };
}
