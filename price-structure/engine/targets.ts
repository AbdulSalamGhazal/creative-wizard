import type { OfferResult } from "./evaluate";
import type { MetricKey, Target } from "./types";

/**
 * The CML metrics a "ROAS for A / B" can be solved for: a target on one of
 * these says how much to KEEP per delivered order, and the rest is the ad
 * budget (brief §5.3, §5.6).
 */
export const ROAS_TARGET_METRICS = ["margin", "profit", "profitPerUnit"] as const;
export type RoasTargetMetric = (typeof ROAS_TARGET_METRICS)[number];

export function isRoasTargetMetric(key: MetricKey): key is RoasTargetMetric {
  return (ROAS_TARGET_METRICS as readonly string[]).includes(key);
}

/** Enabled targets on a CML metric, in stored order. */
export function eligibleRoasTargets(targets: readonly Target[]): Target[] {
  return targets.filter((t) => t.enabled && isRoasTargetMetric(t.metric));
}

/**
 * THE ROAS target (brief §5.6): the one the whole module solves "ROAS for
 * A / B" and "Max CPA for A / B" against.
 *  1. eligible = enabled targets on margin / profit / profitPerUnit
 *  2. the eligible target with id = roasTargetId
 *  3. else the first eligible CML % target
 *  4. else the first eligible target
 *  5. else none
 */
export function resolveRoasTarget(
  targets: readonly Target[],
  roasTargetId: string,
): Target | null {
  const eligible = eligibleRoasTargets(targets);
  if (eligible.length === 0) return null;
  return (
    eligible.find((t) => t.id === roasTargetId) ??
    eligible.find((t) => t.metric === "margin") ??
    eligible[0] ??
    null
  );
}

/** SAR to keep per delivered order for a CML target level `v`. */
function keepPerOrder(r: OfferResult, metric: RoasTargetMetric, v: number): number {
  switch (metric) {
    case "margin":
      return v * r.netRevenue;
    case "profit":
      return v;
    case "profitPerUnit":
      return v * r.units;
  }
}

/**
 * The platform ROAS and the max CPA an offer needs for a CML target level
 * (brief §5.3). At exactly that ROAS (or CPA) the offer's metric equals `v`.
 * ROAS is +∞ (shown "—") and CPA NaN (shown "—") when nothing is left for ads.
 */
export function roasNeeded(
  r: OfferResult,
  metric: RoasTargetMetric,
  v: number,
  usdToSar: number,
): { roas: number; maxCpaUsd: number; maxAdSpend: number } {
  const maxAdSpend = r.deliveryRate * (r.contribution - keepPerOrder(r, metric, v));
  return {
    maxAdSpend,
    roas: maxAdSpend > 0 ? r.paidGross / maxAdSpend : Infinity,
    maxCpaUsd: maxAdSpend > 0 ? maxAdSpend / usdToSar : NaN,
  };
}
