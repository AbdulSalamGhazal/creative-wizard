import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import { getActiveAccountId, getActiveStatusWindowHours } from "@/lib/tenant";
import { hoursToWindowDays } from "@/lib/creative-status";
import { platformSpendFreshness } from "@/db/queries/creative-status";
import { deriveCampaignStatus, type CampaignStatus } from "@/lib/campaign-status";

/**
 * Per-(campaign, platform) last real-spend day for the brand, once per request.
 *
 * Cached and UNRESTRICTED for the same reason as the creative equivalent: the
 * id-restricted form couldn't be shared, and an `IN (…)` list of every visible
 * campaign cost more than scanning. Restriction is a JS filter downstream.
 *
 * This can't merge with `brandStatusInputs`'s activity scan — that one groups by
 * creative, this one by campaign — but the platform FRESHNESS anchor is
 * identical, so both read it from `platformSpendFreshness()`.
 */
const brandCampaignActivity = cache(
  async (): Promise<
    Array<{ campaignId: string | null; platform: string; lastDate: string }>
  > => {
    const acct = await getActiveAccountId();
    return db
      .select({
        campaignId: performanceRecords.campaignId,
        platform: performanceRecords.platform,
        lastDate: sql<string>`MAX(${performanceRecords.date})`,
      })
      .from(performanceRecords)
      .where(
        and(
          eq(performanceRecords.accountId, acct),
          eq(performanceRecords.excludedFromAggregates, false),
          sql`${performanceRecords.spend} > 0`,
        ),
      )
      .groupBy(performanceRecords.campaignId, performanceRecords.platform);
  },
);

/**
 * Dynamic campaign status (active/inactive) for a set of campaigns, or every
 * campaign in the active brand when `campaignIds` is omitted. Returns a Map
 * keyed by campaignId; a campaign ABSENT from the map has never spent → treat as
 * "inactive" (see {@link campaignStatusFor}).
 *
 * A campaign runs on one platform, so it's judged against THAT platform's own
 * latest spend day — the same freshness anchor {@link creativeStatusMap} uses,
 * so a stale channel can't mislabel a still-running campaign. Computed over ALL
 * data (current liveness), independent of any date-range filter. Account-scoped.
 */
export async function campaignStatusMap(
  campaignIds?: string[],
): Promise<Map<string, CampaignStatus>> {
  if (campaignIds && campaignIds.length === 0) return new Map();
  const keep = campaignIds && campaignIds.length > 0 ? new Set(campaignIds) : null;

  const [windowHours, activity, latestByPlatform] = await Promise.all([
    getActiveStatusWindowHours(),
    brandCampaignActivity(),
    platformSpendFreshness(),
  ]);
  const windowDays = hoursToWindowDays(windowHours);

  // Roll up per (campaign × platform): a campaign is Active if it's active on
  // ANY platform it ran on (mirrors the creative-status general roll-up). This
  // matters only for the rare campaign whose registry name carries no platform
  // tag (untagged TikTok/Snapchat sharing a built-name) and thus spans channels;
  // Meta campaigns are tagged (IG)/(FB) so each is single-platform.
  const out = new Map<string, CampaignStatus>();
  for (const a of activity) {
    if (!a.campaignId) continue;
    if (keep && !keep.has(a.campaignId)) continue;
    const status = deriveCampaignStatus({
      lastSpendDay: a.lastDate,
      platformLatestDay: latestByPlatform[a.platform as keyof typeof latestByPlatform] ?? null,
      windowDays,
    });
    if (status === "active" || !out.has(a.campaignId)) {
      out.set(a.campaignId, status);
    }
  }
  return out;
}

/** Look up a campaign's status, defaulting to "inactive" when absent (never spent). */
export function campaignStatusFor(
  map: Map<string, CampaignStatus>,
  campaignId: string,
): CampaignStatus {
  return map.get(campaignId) ?? "inactive";
}
