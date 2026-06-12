/**
 * Pure change-classification logic for Trends → Over time ("what changed").
 *
 * Each entity (platform / campaign / creative) carries component sums for the
 * current and the immediately-prior window. Ratios are recombined here from
 * the sums (weighted averages — never an average of per-row ratios), deltas
 * are direction-aware (CPA up = bad, ROAS down = bad), and each entity gets a
 * severity tier so the page can sort worst-first and warn loudly.
 */

export interface ChangeWindowBlock {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
}

export type ChangeMetricKey = "spend" | "roas" | "cpa" | "ctr" | "cvr";

export interface ChangeMetricDelta {
  key: ChangeMetricKey;
  cur: number | null;
  prev: number | null;
  /** Signed relative change (cur − prev) / prev; null when undefined. */
  change: number | null;
  /** Relative change in the metric's BAD direction (> 0 = got worse).
   *  Null for spend (informational, no good/bad direction) and when the
   *  change itself is undefined. */
  deterioration: number | null;
}

export type ChangeTier = "drop" | "watch" | "gone" | "new" | "stable" | "low";

export interface ChangeAssessment {
  tier: ChangeTier;
  metrics: ChangeMetricDelta[];
  /** The worst-deteriorating ratio metric (drives the "biggest drop" badge). */
  worst: ChangeMetricDelta | null;
}

/** Deterioration ≥ WATCH → amber "Watch"; ≥ DROP → red "Big drop". */
export const CHANGE_WATCH = 0.25;
export const CHANGE_DROP = 0.5;
/** Entities whose bigger window is below this spend never warn — tiny spend
 *  makes ratios swing wildly (the 630× ROAS lesson). */
export const CHANGE_SPEND_FLOOR = 150;

/** Sort rank: loudest problems first. */
export const CHANGE_TIER_ORDER: Record<ChangeTier, number> = {
  drop: 0,
  watch: 1,
  gone: 2,
  new: 3,
  stable: 4,
  low: 5,
};

function safeRatio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function delta(
  key: ChangeMetricKey,
  cur: number | null,
  prev: number | null,
  lowerIsBetter: boolean,
): ChangeMetricDelta {
  const change =
    cur !== null && prev !== null && prev !== 0 ? (cur - prev) / prev : null;
  const deterioration =
    key === "spend" || change === null
      ? null
      : lowerIsBetter
        ? change
        : -change;
  return { key, cur, prev, change, deterioration };
}

export function deriveChangeMetrics(
  cur: ChangeWindowBlock,
  prev: ChangeWindowBlock,
): ChangeMetricDelta[] {
  return [
    delta("spend", cur.spend, prev.spend, false),
    delta(
      "roas",
      safeRatio(cur.conversionValue, cur.spend),
      safeRatio(prev.conversionValue, prev.spend),
      false,
    ),
    delta(
      "cpa",
      safeRatio(cur.spend, cur.conversions),
      safeRatio(prev.spend, prev.conversions),
      true,
    ),
    delta(
      "ctr",
      safeRatio(cur.clicks, cur.impressions),
      safeRatio(prev.clicks, prev.impressions),
      false,
    ),
    delta(
      "cvr",
      safeRatio(cur.conversions, cur.landingPageViews),
      safeRatio(prev.conversions, prev.landingPageViews),
      false,
    ),
  ];
}

export function assessChange(
  cur: ChangeWindowBlock,
  prev: ChangeWindowBlock,
): ChangeAssessment {
  const metrics = deriveChangeMetrics(cur, prev);
  const rated = metrics.filter((m) => m.deterioration !== null);
  const worst =
    rated.length > 0
      ? rated.reduce((a, b) =>
          (b.deterioration ?? -Infinity) > (a.deterioration ?? -Infinity) ? b : a,
        )
      : null;

  let tier: ChangeTier;
  if (Math.max(cur.spend, prev.spend) < CHANGE_SPEND_FLOOR) {
    tier = "low";
  } else if (prev.spend === 0) {
    tier = "new";
  } else if (cur.spend === 0) {
    tier = "gone";
  } else if ((worst?.deterioration ?? 0) >= CHANGE_DROP) {
    tier = "drop";
  } else if ((worst?.deterioration ?? 0) >= CHANGE_WATCH) {
    tier = "watch";
  } else {
    tier = "stable";
  }

  return { tier, metrics, worst };
}
