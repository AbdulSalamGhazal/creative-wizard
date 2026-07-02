import { isoMinusDays } from "@/lib/creative-status";

/**
 * Dynamic campaign status — the campaign analogue of creative status, collapsed
 * to two states (per product ask). A campaign runs on exactly one platform
 * (E060), so it's judged against THAT platform's own latest spend day, the same
 * freshness anchor creatives use:
 *
 *  - active:   spent (spend > 0) within the configured window of its platform's
 *              latest spend day.
 *  - inactive: spent before but not within the window, OR never spent.
 *
 * Purely derived from spend recency (no manual override, no stored column).
 */
export const CAMPAIGN_STATUSES = ["active", "inactive"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

/** Dot/badge color per status (theme CSS vars): green = running, gray = not. */
export const CAMPAIGN_STATUS_DOT: Record<CampaignStatus, string> = {
  active: "var(--pos)",
  inactive: "var(--ink-3)",
};

/** Sort rank (most-relevant → least): active ▸ inactive. */
export const CAMPAIGN_STATUS_ORDER: Record<CampaignStatus, number> = {
  active: 0,
  inactive: 1,
};

export interface CampaignStatusInput {
  /** The campaign's last real-spend date (YYYY-MM-DD), or null if it never spent. */
  lastSpendDay: string | null;
  /** Its platform's latest spend day in the brand (the freshness anchor), or null. */
  platformLatestDay: string | null;
  /** Active window in whole days (see hoursToWindowDays). */
  windowDays: number;
}

/**
 * Active iff the campaign's last spend day falls within `windowDays` of its
 * platform's latest spend day. Never-spent (or no platform anchor) → inactive.
 * Same math as {@link deriveCreativeStatus}'s per-platform branch.
 */
export function deriveCampaignStatus({
  lastSpendDay,
  platformLatestDay,
  windowDays,
}: CampaignStatusInput): CampaignStatus {
  if (!lastSpendDay || !platformLatestDay) return "inactive";
  return lastSpendDay >= isoMinusDays(platformLatestDay, windowDays - 1)
    ? "active"
    : "inactive";
}
