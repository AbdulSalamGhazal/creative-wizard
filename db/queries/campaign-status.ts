import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import { getActiveAccountId, getActiveStatusWindowHours } from "@/lib/tenant";
import { hoursToWindowDays } from "@/lib/creative-status";
import { deriveCampaignStatus, type CampaignStatus } from "@/lib/campaign-status";

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
  const restrict = Boolean(campaignIds && campaignIds.length > 0);

  const [acct, windowHours] = await Promise.all([
    getActiveAccountId(),
    getActiveStatusWindowHours(),
  ]);
  const windowDays = hoursToWindowDays(windowHours);

  // Per-campaign last real-spend day (+ its platform), spend > 0, non-excluded.
  const activity = await db
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
        ...(restrict
          ? [inArray(performanceRecords.campaignId, campaignIds!)]
          : []),
      ),
    )
    .groupBy(performanceRecords.campaignId, performanceRecords.platform);

  // Each platform's latest SPEND day in the brand (the freshness anchor). Matches
  // the activity query's spend > 0 so a trailing $0 day can't flip a live
  // campaign to inactive.
  const freshness = await db
    .select({
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
    .groupBy(performanceRecords.platform);

  const latestByPlatform = new Map<string, string>();
  for (const f of freshness) latestByPlatform.set(f.platform, f.lastDate);

  // Roll up per (campaign × platform): a campaign is Active if it's active on
  // ANY platform it ran on (mirrors the creative-status general roll-up). This
  // matters only for the rare campaign whose registry name carries no platform
  // tag (untagged TikTok/Snapchat sharing a built-name) and thus spans channels;
  // Meta campaigns are tagged (IG)/(FB) so each is single-platform.
  const out = new Map<string, CampaignStatus>();
  for (const a of activity) {
    if (!a.campaignId) continue;
    const status = deriveCampaignStatus({
      lastSpendDay: a.lastDate,
      platformLatestDay: latestByPlatform.get(a.platform) ?? null,
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
