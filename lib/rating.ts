/**
 * Creative rating shown on /summary.
 *
 * A rating is derived live from a metric block's ROAS, gated by a minimum
 * spend so low-spend (barely-tested) creatives read as N/A rather than being
 * judged on noise. The same global cutoffs apply to each platform's own
 * values and to the blended total.
 *
 *   no data / block missing          → "na"
 *   spend < minSpend                 → "na"   (not enough spend to judge)
 *   ROAS unknown (null)              → "na"
 *   ROAS >= goodRoas                 → "good"
 *   ROAS >= decentRoas               → "decent"
 *   otherwise (has spend, low ROAS)  → "bad"
 *
 * The rules live in the rating_rules singleton (admin-editable at
 * /admin/catalog?tab=rating). DEFAULT_RATING_RULES is the fallback when the
 * row hasn't been seeded yet.
 */

export type Rating = "good" | "decent" | "bad" | "na";

/** All ratings, best → worst. The order doubles as the sort rank. */
export const RATING_VALUES = ["good", "decent", "bad", "na"] as const;

/** Sort rank: higher = better. Used to order the Rate column. */
export const RATING_RANK: Record<Rating, number> = {
  good: 4,
  decent: 3,
  bad: 2,
  na: 1,
};

export interface RatingRules {
  /** Minimum spend (USD) for a block to be rated at all. */
  minSpend: number;
  /** ROAS at or above this → Good. */
  goodRoas: number;
  /** ROAS at or above this (and below good) → Decent. */
  decentRoas: number;
}

export const DEFAULT_RATING_RULES: RatingRules = {
  minSpend: 500,
  goodRoas: 4,
  decentRoas: 2,
};

/**
 * The full rating config: a default (blended total + any platform without an
 * override) plus optional per-platform overrides keyed by platform name.
 */
export interface RatingConfig {
  default: RatingRules;
  byPlatform: Record<string, RatingRules>;
}

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  default: DEFAULT_RATING_RULES,
  byPlatform: {},
};

/**
 * Resolve the rules that apply to a rating scope. The blended total ("total")
 * always uses the default; a platform uses its override when present, else the
 * default.
 */
export function rulesForScope(config: RatingConfig, scope: string): RatingRules {
  if (scope === "total") return config.default;
  return config.byPlatform[scope] ?? config.default;
}

/** The minimal shape needed to rate a block. */
export interface RatableBlock {
  spend: number;
  roas: number | null;
}

export function rateBlock(
  block: RatableBlock | undefined | null,
  rules: RatingRules,
): Rating {
  if (!block) return "na";
  if (block.spend < rules.minSpend) return "na";
  if (block.roas === null || block.roas === undefined) return "na";
  if (block.roas >= rules.goodRoas) return "good";
  if (block.roas >= rules.decentRoas) return "decent";
  return "bad";
}

/** Display label + Tailwind classes (semantic theme tokens) per rating. */
export const RATING_META: Record<
  Rating,
  { label: string; badgeClass: string }
> = {
  good: { label: "Good", badgeClass: "border-pos/40 text-pos bg-pos/10" },
  decent: { label: "Decent", badgeClass: "border-warn/40 text-warn bg-warn/10" },
  bad: { label: "Bad", badgeClass: "border-neg/40 text-neg bg-neg/10" },
  na: { label: "N/A", badgeClass: "border-line-2 text-ink-3 bg-surface-2" },
};
