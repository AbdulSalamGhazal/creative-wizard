import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creativePlatformOverrides, performanceRecords } from "@/db/schema";
import { getActiveAccountId, getActiveStatusWindowHours } from "@/lib/tenant";
import {
  deriveCreativeStatus,
  hoursToWindowDays,
  NEW_STATUS,
  type CreativeStatusInput,
  type CreativeStatusResult,
  type Platform,
} from "@/lib/creative-status";

/**
 * Dynamic creative status (general + per-platform) for a set of creatives, or
 * for every creative in the active brand when `creativeIds` is omitted. Returns
 * a Map keyed by creativeId. A creative ABSENT from the map has never spent and
 * isn't terminated → treat as "new" (see {@link statusFor}).
 *
 * Each platform's "Active" window is anchored to that platform's own latest
 * data day (uploads are per-platform), so a stale channel can't mislabel a
 * still-running creative. Everything is scoped to the active account.
 */
export async function creativeStatusMap(
  creativeIds?: string[],
): Promise<Map<string, CreativeStatusResult>> {
  if (creativeIds && creativeIds.length === 0) return new Map();
  const restrict = Boolean(creativeIds && creativeIds.length > 0);

  const [acct, windowHours] = await Promise.all([
    getActiveAccountId(),
    getActiveStatusWindowHours(),
  ]);
  const windowDays = hoursToWindowDays(windowHours);

  // Per-(creative, platform) last real-spend date (spend > 0, non-excluded).
  const activity = await db
    .select({
      creativeId: performanceRecords.creativeId,
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
          ? [inArray(performanceRecords.creativeId, creativeIds!)]
          : []),
      ),
    )
    .groupBy(performanceRecords.creativeId, performanceRecords.platform);

  // Each platform's latest data day in the brand (the freshness anchor).
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
      ),
    )
    .groupBy(performanceRecords.platform);

  // Manual terminations.
  const overrides = await db
    .select({
      creativeId: creativePlatformOverrides.creativeId,
      platform: creativePlatformOverrides.platform,
    })
    .from(creativePlatformOverrides)
    .where(
      and(
        eq(creativePlatformOverrides.accountId, acct),
        ...(restrict
          ? [inArray(creativePlatformOverrides.creativeId, creativeIds!)]
          : []),
      ),
    );

  const latestDayByPlatform: Partial<Record<Platform, string>> = {};
  for (const f of freshness) latestDayByPlatform[f.platform as Platform] = f.lastDate;

  const inputs = new Map<string, CreativeStatusInput>();
  const ensure = (id: string): CreativeStatusInput => {
    let e = inputs.get(id);
    if (!e) {
      e = { lastSpendByPlatform: {}, terminatedPlatforms: [] };
      inputs.set(id, e);
    }
    return e;
  };
  for (const a of activity) {
    ensure(a.creativeId).lastSpendByPlatform[a.platform as Platform] = a.lastDate;
  }
  for (const o of overrides) {
    ensure(o.creativeId).terminatedPlatforms.push(o.platform as Platform);
  }

  const ctx = { latestDayByPlatform, windowDays };
  const out = new Map<string, CreativeStatusResult>();
  for (const [id, input] of inputs) out.set(id, deriveCreativeStatus(input, ctx));
  return out;
}

/** Look up a creative's status, defaulting to "new" when absent from the map. */
export function statusFor(
  map: Map<string, CreativeStatusResult>,
  creativeId: string,
): CreativeStatusResult {
  return map.get(creativeId) ?? NEW_STATUS;
}

/** Just the per-platform termination set for one creative (for the detail UI). */
export async function terminatedPlatformsFor(
  creativeId: string,
): Promise<Platform[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({ platform: creativePlatformOverrides.platform })
    .from(creativePlatformOverrides)
    .where(
      and(
        eq(creativePlatformOverrides.accountId, acct),
        eq(creativePlatformOverrides.creativeId, creativeId),
      ),
    );
  return rows.map((r) => r.platform as Platform);
}
