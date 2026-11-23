/**
 * THE LEVEL of a campaign-side breakdown (2026-11, the two levels of
 * lib/campaign.ts): by CAMPAIGN (a `parent_campaigns` row — the default, the
 * clean URL) or by AD SET (a `campaigns` row, `?level=adset`). Funnel and the
 * one-platform Dashboard read it; Trends › Changes carries the same choice
 * inside its own `?dim=`.
 *
 * Client-safe and dependency-free: the switch (a client component), the pages
 * and the query layer's dimension all read this one module.
 */
export const BREAKDOWN_LEVELS = ["campaign", "adset"] as const;
export type BreakdownLevel = (typeof BREAKDOWN_LEVELS)[number];

export const BREAKDOWN_LEVEL_LABEL: Record<BreakdownLevel, string> = {
  campaign: "Campaign",
  adset: "Ad set",
};

/** `?level=` → a level; anything else is the campaign level. */
export function parseBreakdownLevel(value: string | null | undefined): BreakdownLevel {
  return value === "adset" ? "adset" : "campaign";
}

/**
 * The query layer's word for a level. `campaign` there is the AD SET (the
 * stored vocabulary — never renamed); the campaign is `parent_campaign`.
 */
export function levelDimension(level: BreakdownLevel): "parent_campaign" | "campaign" {
  return level === "campaign" ? "parent_campaign" : "campaign";
}

/** The UI's word for a breakdown dimension that isn't the platform. */
export function dimensionNoun(dimension: "campaign" | "parent_campaign", count = 1): string {
  const one = dimension === "parent_campaign" ? "campaign" : "ad set";
  return count === 1 ? one : `${one}s`;
}
