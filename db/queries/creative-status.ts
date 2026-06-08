import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creativePlatformOverrides,
  creatives,
  performanceRecords,
  platformEnum,
} from "@/db/schema";
import { getActiveAccountId, getActiveStatusWindowHours } from "@/lib/tenant";
import {
  deriveCreativeStatus,
  hoursToWindowDays,
  NEW_STATUS,
  type CreativeStatus,
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
  opts?: { asOf?: string },
): Promise<Map<string, CreativeStatusResult>> {
  if (creativeIds && creativeIds.length === 0) return new Map();
  const restrict = Boolean(creativeIds && creativeIds.length > 0);
  const asOf = opts?.asOf; // point-in-time: status as it stood on this ISO date

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
        ...(asOf ? [sql`${performanceRecords.date} <= ${asOf}`] : []),
        ...(restrict
          ? [inArray(performanceRecords.creativeId, creativeIds!)]
          : []),
      ),
    )
    .groupBy(performanceRecords.creativeId, performanceRecords.platform);

  // Each platform's latest data day in the brand (the freshness anchor) — as of
  // `asOf` when reconstructing a point-in-time snapshot.
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
        ...(asOf ? [sql`${performanceRecords.date} <= ${asOf}`] : []),
      ),
    )
    .groupBy(performanceRecords.platform);

  // Manual terminations (only those applied on or before `asOf`).
  const overrides = await db
    .select({
      creativeId: creativePlatformOverrides.creativeId,
      platform: creativePlatformOverrides.platform,
    })
    .from(creativePlatformOverrides)
    .where(
      and(
        eq(creativePlatformOverrides.accountId, acct),
        ...(asOf
          ? [sql`${creativePlatformOverrides.terminatedAt}::date <= ${asOf}`]
          : []),
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

export interface PlatformStatusCounts {
  /** Creatives that have never run (and aren't terminated) on this platform =
   *  total − present. Per-platform "new" is derived, not a stored status. */
  new: number;
  active: number;
  pause: number;
  terminated: number;
}

export interface CreativeStatusBreakdown {
  total: number;
  /** General (roll-up) status counts across all creatives in the brand. */
  general: Record<CreativeStatus, number>;
  /** Per-platform counts of creatives present on that platform, by status. */
  perPlatform: Record<Platform, PlatformStatusCounts>;
}

/**
 * Library header stats: total, the general status breakdown
 * (new/active/pause/terminated), and a per-platform breakdown. Computed from a
 * SINGLE status-map pass (account-scoped). A creative absent from the map has
 * no spend and no termination → counts as New.
 */
export async function creativeStatusBreakdown(): Promise<CreativeStatusBreakdown> {
  const acct = await getActiveAccountId();

  const [counts] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(creatives)
    .where(eq(creatives.accountId, acct));
  const total = Number(counts?.total ?? 0);

  const map = await creativeStatusMap();

  const general: Record<CreativeStatus, number> = {
    new: 0,
    active: 0,
    pause: 0,
    terminated: 0,
  };
  const perPlatform = {} as Record<Platform, PlatformStatusCounts>;
  for (const p of platformEnum) {
    perPlatform[p as Platform] = { new: 0, active: 0, pause: 0, terminated: 0 };
  }

  for (const res of map.values()) {
    general[res.general] += 1; // in-map general is always active/pause/terminated
    for (const p of platformEnum) {
      const s = res.perPlatform[p as Platform];
      if (s) perPlatform[p as Platform][s] += 1;
    }
  }
  // Creatives with no spend and no termination never enter the map → all New.
  general.new = Math.max(0, total - map.size);

  // Per-platform "new" = every creative not present (running/paused/terminated)
  // on that platform — i.e. it has never started there.
  for (const p of platformEnum) {
    const c = perPlatform[p as Platform];
    c.new = Math.max(0, total - (c.active + c.pause + c.terminated));
  }

  return { total, general, perPlatform };
}

export interface StatusTransition {
  from: CreativeStatus;
  to: CreativeStatus;
  count: number;
}

export interface CreativeStatusTransitions {
  /** Every (from → to) pair with a count > 0, including unchanged (from===to). */
  transitions: StatusTransition[];
  startCounts: Record<CreativeStatus, number>;
  endCounts: Record<CreativeStatus, number>;
  total: number;
}

function isoMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * How creatives moved between dynamic statuses over a window: their status as
 * it stood just before `from` vs. as of `to`. Built from two point-in-time
 * status snapshots (see {@link creativeStatusMap} `asOf`), so this reconstructs
 * historical status — New/Active/Pause is re-derived as-of each date and
 * Terminated honors `terminated_at`. Account-scoped.
 *
 * Only creatives with any spend/termination history at either end are counted
 * (a creative that was New and stayed New — never spent — adds no flow).
 */
export async function creativeStatusTransitions(
  from: string,
  to: string,
): Promise<CreativeStatusTransitions> {
  const [startMap, endMap] = await Promise.all([
    creativeStatusMap(undefined, { asOf: isoMinusOneDay(from) }),
    creativeStatusMap(undefined, { asOf: to }),
  ]);

  const ids = new Set<string>([...startMap.keys(), ...endMap.keys()]);
  const zero = (): Record<CreativeStatus, number> => ({
    new: 0,
    active: 0,
    pause: 0,
    terminated: 0,
  });
  const startCounts = zero();
  const endCounts = zero();
  const counts = new Map<string, number>();

  for (const id of ids) {
    const f = statusFor(startMap, id).general;
    const t = statusFor(endMap, id).general;
    startCounts[f] += 1;
    endCounts[t] += 1;
    const key = `${f}|${t}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const transitions: StatusTransition[] = [...counts.entries()].map(([k, count]) => {
    const [f, t] = k.split("|") as [CreativeStatus, CreativeStatus];
    return { from: f, to: t, count };
  });

  return { transitions, startCounts, endCounts, total: ids.size };
}
