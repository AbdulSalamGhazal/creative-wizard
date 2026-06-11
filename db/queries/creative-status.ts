import { and, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creativePlatformOverrides,
  creatives,
  creativeTags,
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
    // NB: an in-map general CAN be "new" — a creative terminated on one platform
    // but never spent anywhere rolls up to New (hasAnyNew). So count it here…
    general[res.general] += 1;
    for (const p of platformEnum) {
      const s = res.perPlatform[p as Platform];
      if (s) perPlatform[p as Platform][s] += 1;
    }
  }
  // …and ADD (not overwrite) the creatives that never entered the map (no spend
  // and no termination → New). Overwriting would drop the in-map News above and
  // make the four buckets sum to less than `total`.
  general.new += Math.max(0, total - map.size);

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
  /** Creatives that appear in the flow (had any spend/termination at either end). */
  total: number;
  /** New-at-both-ends creatives left OUT of the flow (never spent or terminated). */
  untouchedNew: number;
}

function isoMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface StatusTransitionFilters {
  from: string;
  to: string;
  /** Creative-attribute filters that scope the flow (NOT platform — status is a
   *  per-platform concept, so the platform filter is intentionally not applied
   *  here). */
  productIds?: string[];
  types?: Array<"video" | "image" | "slides">;
  tags?: string[];
}

/** Creative IDs matching the product/type/tag filters (account-scoped), or
 *  undefined when none of those filters are set (→ whole brand). */
async function statusRestrictIds(
  filters: StatusTransitionFilters,
): Promise<string[] | undefined> {
  const hasAttr =
    (filters.productIds && filters.productIds.length > 0) ||
    (filters.types && filters.types.length > 0) ||
    (filters.tags && filters.tags.length > 0);
  if (!hasAttr) return undefined;

  const acct = await getActiveAccountId();
  const conds: SQL[] = [eq(creatives.accountId, acct)];
  if (filters.productIds && filters.productIds.length > 0) {
    conds.push(inArray(creatives.productId, filters.productIds));
  }
  if (filters.types && filters.types.length > 0) {
    conds.push(inArray(creatives.type, filters.types));
  }
  if (filters.tags && filters.tags.length > 0) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${creativeTags} WHERE ${creativeTags.creativeId} = ${creatives.id} AND ${inArray(creativeTags.tag, filters.tags)})`,
    );
  }
  const rows = await db.select({ id: creatives.id }).from(creatives).where(and(...conds));
  return rows.map((r) => r.id);
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
  filters: StatusTransitionFilters,
): Promise<CreativeStatusTransitions> {
  const restrictIds = await statusRestrictIds(filters);

  const [startMap, endMap] = await Promise.all([
    creativeStatusMap(restrictIds, { asOf: isoMinusOneDay(filters.from) }),
    creativeStatusMap(restrictIds, { asOf: filters.to }),
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
  let counted = 0;

  for (const id of ids) {
    const f = statusFor(startMap, id).general;
    const t = statusFor(endMap, id).general;
    // New→New is "no real change" (e.g. a creative terminated on one platform
    // with no spend rolls up to New) — drop it from the flow entirely so it
    // shows neither as a ribbon nor in the untouched count.
    if (f === "new" && t === "new") continue;
    counted += 1;
    startCounts[f] += 1;
    endCounts[t] += 1;
    const key = `${f}|${t}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const transitions: StatusTransition[] = [...counts.entries()].map(([k, count]) => {
    const [f, t] = k.split("|") as [CreativeStatus, CreativeStatus];
    return { from: f, to: t, count };
  });

  // The bulk left out of the flow: creatives New at both ends (never spent, never
  // terminated) = the in-scope population minus those with any history.
  let totalCreatives: number;
  if (restrictIds) {
    totalCreatives = restrictIds.length;
  } else {
    const acct = await getActiveAccountId();
    const [cnt] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(creatives)
      .where(eq(creatives.accountId, acct));
    totalCreatives = Number(cnt?.total ?? 0);
  }
  const untouchedNew = Math.max(0, totalCreatives - ids.size);

  return { transitions, startCounts, endCounts, total: counted, untouchedNew };
}

// ---------------------------------------------------------------------------
// Status-flow BREAKDOWN — four diagrams in one row, no all-platforms roll-up.
//   • dimension "platform": one diagram per platform (the four below), using
//     each platform's own per-platform status (New/Active/Pause/Terminated).
//   • dimension "campaign": one diagram per top-4-by-spend campaign on the
//     single filtered platform, using campaign-scoped status — New (never
//     joined the campaign) / Active (spending in it now) / Pause (spent then
//     stopped). No Terminated: termination is per creative×platform, not per
//     campaign.
// Both keep the same start-of-window → now transition shape as the single flow.
// ---------------------------------------------------------------------------

/** Platforms shown in the status-flow grid. */
export const FLOW_PLATFORMS: Platform[] = [
  "instagram",
  "facebook",
  "tiktok",
  "snapchat",
];

export interface StatusFlowScope {
  /** Platform value or campaign name. */
  key: string;
  data: CreativeStatusTransitions;
}

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const zeroCounts = (): Record<CreativeStatus, number> => ({
  new: 0,
  active: 0,
  pause: 0,
  terminated: 0,
});

/** Roll a set of per-creative (start, end) status pairs into a transitions
 *  dataset. `universeTotal` is the full in-scope population (for the untouched
 *  "never moved" count); New→New pairs are dropped from the flow. */
function buildTransitions(
  ids: Iterable<string>,
  statusAt: (id: string) => {
    s: CreativeStatus;
    e: CreativeStatus;
    present: boolean;
  },
  universeTotal: number,
): CreativeStatusTransitions {
  const startCounts = zeroCounts();
  const endCounts = zeroCounts();
  const counts = new Map<string, number>();
  let counted = 0;
  let present = 0;
  for (const id of ids) {
    const { s, e, present: pres } = statusAt(id);
    if (pres) present += 1;
    if (s === "new" && e === "new") continue;
    counted += 1;
    startCounts[s] += 1;
    endCounts[e] += 1;
    const k = `${s}|${e}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const transitions: StatusTransition[] = [...counts.entries()].map(([k, c]) => {
    const [f, t] = k.split("|") as [CreativeStatus, CreativeStatus];
    return { from: f, to: t, count: c };
  });
  return {
    transitions,
    startCounts,
    endCounts,
    total: counted,
    untouchedNew: Math.max(0, universeTotal - present),
  };
}

export async function statusFlowBreakdown(
  filters: StatusTransitionFilters,
  dimension: "platform" | "campaign",
  platform?: Platform,
): Promise<StatusFlowScope[]> {
  const restrictIds = await statusRestrictIds(filters);
  const acct = await getActiveAccountId();

  // --- Per-platform breakdown (default) -----------------------------------
  if (dimension !== "campaign" || !platform) {
    const [startMap, endMap] = await Promise.all([
      creativeStatusMap(restrictIds, { asOf: isoMinusOneDay(filters.from) }),
      creativeStatusMap(restrictIds, { asOf: filters.to }),
    ]);
    let totalInScope: number;
    if (restrictIds) {
      totalInScope = restrictIds.length;
    } else {
      const [c] = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(creatives)
        .where(eq(creatives.accountId, acct));
      totalInScope = Number(c?.total ?? 0);
    }
    const ids = new Set<string>([...startMap.keys(), ...endMap.keys()]);
    return FLOW_PLATFORMS.map((p) => ({
      key: p,
      data: buildTransitions(
        ids,
        (id) => {
          const s = startMap.get(id)?.perPlatform[p];
          const e = endMap.get(id)?.perPlatform[p];
          return { s: s ?? "new", e: e ?? "new", present: Boolean(s || e) };
        },
        totalInScope,
      ),
    }));
  }

  // --- Per-campaign breakdown (single platform filtered) ------------------
  const P = platform;
  const windowDays = hoursToWindowDays(await getActiveStatusWindowHours());
  const startAsOf = isoMinusOneDay(filters.from);
  const endAsOf = filters.to;

  const scopeConds = (extra: SQL[]): SQL[] => {
    const c: SQL[] = [
      eq(performanceRecords.accountId, acct),
      eq(performanceRecords.platform, P),
      eq(performanceRecords.excludedFromAggregates, false),
      ...extra,
    ];
    if (restrictIds) c.push(inArray(performanceRecords.creativeId, restrictIds));
    return c;
  };

  // Top 4 campaigns on P by spend within the window.
  const topRows = await db
    .select({
      campaign: performanceRecords.campaignName,
      spend: sql<number>`SUM(${performanceRecords.spend})`,
    })
    .from(performanceRecords)
    .where(and(...scopeConds([between(performanceRecords.date, filters.from, filters.to)])))
    .groupBy(performanceRecords.campaignName)
    .orderBy(desc(sql`SUM(${performanceRecords.spend})`))
    .limit(4);
  const campaigns = topRows.map((r) => r.campaign);
  if (campaigns.length === 0) return [];

  // Universe = creatives that ran on P (any time up to `to`) — so "New" for a
  // campaign means "on this platform but never joined this campaign".
  const uniRows = await db
    .select({ id: performanceRecords.creativeId })
    .from(performanceRecords)
    .where(
      and(
        ...scopeConds([
          sql`${performanceRecords.spend} > 0`,
          sql`${performanceRecords.date} <= ${endAsOf}`,
        ]),
      ),
    )
    .groupBy(performanceRecords.creativeId);
  const universe = uniRows.map((r) => r.id);

  // Each platform's freshness anchor at each as-of (latest data day ≤ as-of).
  const latestDay = async (asOf: string): Promise<string | null> => {
    const [r] = await db
      .select({ last: sql<string>`MAX(${performanceRecords.date})` })
      .from(performanceRecords)
      .where(
        and(
          eq(performanceRecords.accountId, acct),
          eq(performanceRecords.platform, P),
          eq(performanceRecords.excludedFromAggregates, false),
          sql`${performanceRecords.date} <= ${asOf}`,
        ),
      );
    return r?.last ?? null;
  };

  // Per-(creative, campaign) last spend date on P, as of `asOf`.
  const lastSpend = async (asOf: string): Promise<Map<string, Map<string, string>>> => {
    const rows = await db
      .select({
        creativeId: performanceRecords.creativeId,
        campaign: performanceRecords.campaignName,
        last: sql<string>`MAX(${performanceRecords.date})`,
      })
      .from(performanceRecords)
      .where(
        and(
          ...scopeConds([
            inArray(performanceRecords.campaignName, campaigns),
            sql`${performanceRecords.spend} > 0`,
            sql`${performanceRecords.date} <= ${asOf}`,
          ]),
        ),
      )
      .groupBy(performanceRecords.creativeId, performanceRecords.campaignName);
    const m = new Map<string, Map<string, string>>();
    for (const r of rows) {
      let cm = m.get(r.campaign);
      if (!cm) {
        cm = new Map();
        m.set(r.campaign, cm);
      }
      cm.set(r.creativeId, r.last);
    }
    return m;
  };

  const [startAnchor, endAnchor, startSpend, endSpend] = await Promise.all([
    latestDay(startAsOf),
    latestDay(endAsOf),
    lastSpend(startAsOf),
    lastSpend(endAsOf),
  ]);

  const statusOf = (
    last: string | undefined,
    anchor: string | null,
  ): CreativeStatus => {
    if (!last) return "new";
    if (!anchor) return "pause";
    return last >= isoMinusDays(anchor, windowDays - 1) ? "active" : "pause";
  };

  return campaigns.map((c) => {
    const startC = startSpend.get(c) ?? new Map<string, string>();
    const endC = endSpend.get(c) ?? new Map<string, string>();
    return {
      key: c,
      data: buildTransitions(
        universe,
        (id) => ({
          s: statusOf(startC.get(id), startAnchor),
          e: statusOf(endC.get(id), endAnchor),
          present: startC.has(id) || endC.has(id),
        }),
        universe.length,
      ),
    };
  });
}
