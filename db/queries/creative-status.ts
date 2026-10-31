import { cache } from "react";
import { and, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creativePlatformOverrides,
  creatives,
  creativeAngles,
  performanceRecords,
  platformEnum,
} from "@/db/schema";
import { getActiveAccountId, getActiveStatusWindowHours } from "@/lib/tenant";
import { shiftIso } from "@/lib/date-presets";
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
 * The RAW datasets every status derivation needs, fetched ONCE per request.
 *
 * Status is derived on nearly every page, and each consumer used to run its own
 * three scans of `performance_records` — the dashboard alone paid for several
 * copies of the same data. `lib/db.ts` holds ONE connection per instance, so
 * those queries were serial: the win here is issuing fewer of them, not running
 * them in parallel.
 *
 * Deliberately UNRESTRICTED (whole brand): an id-restricted variant couldn't be
 * shared between callers, and restricting was itself costly — callers passed
 * hundreds of ids into an `IN (…)` list to fetch a subset of a scan the request
 * had usually already done. Restriction is now a JS filter over this result.
 *
 * `cache()` is per-REQUEST (React clears it between requests), so this never
 * serves one brand's rows to another: the memo lives and dies inside a single
 * server render, and the account is resolved inside it.
 */
export interface BrandStatusInputs {
  /** Brand's Active window in whole days (from `accounts.status_window_hours`). */
  windowDays: number;
  /** Last real-spend day per (creative, platform) — spend > 0, non-excluded. */
  activity: Array<{ creativeId: string; platform: string; lastDate: string }>;
  /** Each platform's own latest spend day — the per-channel freshness anchor. */
  latestDayByPlatform: Partial<Record<Platform, string>>;
  /** Manual per-(creative, platform) terminations. */
  overrides: Array<{ creativeId: string; platform: string }>;
}

/**
 * Every manual termination of the brand, with the DAY it took effect (the
 * database's own `terminated_at::date`, so the as-of comparison below can't
 * drift from the SQL it replaced). A tiny table read ONCE per request (W2-3,
 * 2026-10): the cached inputs use it as they are, and the `asOf` reconstruction
 * filters it by day in JS — the Dashboard read it three times before.
 */
export const brandOverrides = cache(
  async (): Promise<Array<{ creativeId: string; platform: string; terminatedOn: string }>> => {
    const acct = await getActiveAccountId();
    return db
      .select({
        creativeId: creativePlatformOverrides.creativeId,
        platform: creativePlatformOverrides.platform,
        terminatedOn: sql<string>`(${creativePlatformOverrides.terminatedAt})::date::text`,
      })
      .from(creativePlatformOverrides)
      .where(eq(creativePlatformOverrides.accountId, acct));
  },
);

/**
 * Each platform's latest SPEND day for the brand. Split out and cached on its
 * own because BOTH creative and campaign status anchor to it — the two activity
 * scans group differently (by creative vs by campaign) and can't be merged, but
 * this freshness scan is identical for both and now runs once per request.
 */
export const platformSpendFreshness = cache(
  async (): Promise<Partial<Record<Platform, string>>> => {
    const acct = await getActiveAccountId();
    const rows = await db
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
    const out: Partial<Record<Platform, string>> = {};
    for (const r of rows) out[r.platform as Platform] = r.lastDate;
    return out;
  },
);

/**
 * The three status datasets for the active brand, once per request.
 *
 * NEVER add another direct status scan alongside this — derive from it. (The
 * `asOf` point-in-time variant is the one sanctioned exception: it reconstructs
 * a past day, so it can't read today's cached numbers.)
 */
export const brandStatusInputs = cache(async (): Promise<BrandStatusInputs> => {
  const [acct, windowHours] = await Promise.all([
    getActiveAccountId(),
    getActiveStatusWindowHours(),
  ]);

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
      ),
    )
    .groupBy(performanceRecords.creativeId, performanceRecords.platform);

  const latestDayByPlatform = await platformSpendFreshness();

  const overrides = (await brandOverrides()).map(({ creativeId, platform }) => ({
    creativeId,
    platform,
  }));

  return {
    windowDays: hoursToWindowDays(windowHours),
    activity,
    latestDayByPlatform,
    overrides,
  };
});

/** Assemble a status map from raw rows + context, filtered to `keep` if given. */
function buildStatusMap(
  activity: BrandStatusInputs["activity"],
  overrides: BrandStatusInputs["overrides"],
  ctx: { latestDayByPlatform: Partial<Record<Platform, string>>; windowDays: number },
  keep: Set<string> | null,
): Map<string, CreativeStatusResult> {
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
    if (keep && !keep.has(a.creativeId)) continue;
    ensure(a.creativeId).lastSpendByPlatform[a.platform as Platform] = a.lastDate;
  }
  for (const o of overrides) {
    if (keep && !keep.has(o.creativeId)) continue;
    ensure(o.creativeId).terminatedPlatforms.push(o.platform as Platform);
  }
  const out = new Map<string, CreativeStatusResult>();
  for (const [id, input] of inputs) out.set(id, deriveCreativeStatus(input, ctx));
  return out;
}

/**
 * Dynamic creative status (general + per-platform) for a set of creatives, or
 * for every creative in the active brand when `creativeIds` is omitted. Returns
 * a Map keyed by creativeId. A creative ABSENT from the map has never spent and
 * isn't terminated → treat as "new" (see {@link statusFor}).
 *
 * Each platform's "Active" window is anchored to that platform's own latest
 * data day (uploads are per-platform), so a stale channel can't mislabel a
 * still-running creative. Everything is scoped to the active account.
 *
 * Without `asOf` this derives from {@link brandStatusInputs} — the scans happen
 * once per request no matter how many callers ask. `creativeIds` is a filter on
 * the RESULT; callers that only look rows up by id can omit it entirely.
 */
export async function creativeStatusMap(
  creativeIds?: string[],
  opts?: { asOf?: string },
): Promise<Map<string, CreativeStatusResult>> {
  if (creativeIds && creativeIds.length === 0) return new Map();
  const keep = creativeIds && creativeIds.length > 0 ? new Set(creativeIds) : null;

  if (!opts?.asOf) {
    const { windowDays, activity, latestDayByPlatform, overrides } =
      await brandStatusInputs();
    return buildStatusMap(activity, overrides, { latestDayByPlatform, windowDays }, keep);
  }

  // Point-in-time: reconstructs a PAST day, so it can't read today's cached
  // numbers and keeps its own (date-bounded) queries.
  const [map] = await creativeStatusMapsAsOf(creativeIds, [opts.asOf]);
  return map!;
}

/**
 * `MAX(date)` as of each day in `days`, in ONE grouped pass: the WHERE bounds
 * the scan by the latest day and a FILTER per day bounds each column — the
 * same value a `date <= day` query per day returns, NULL where nothing had
 * happened by then.
 */
function maxDateAsOf(days: readonly string[]): Record<string, SQL<string | null>> {
  const cols: Record<string, SQL<string | null>> = {};
  days.forEach((d, i) => {
    cols[`d${i}`] = sql<string | null>`MAX(${performanceRecords.date}) FILTER (WHERE ${performanceRecords.date} <= ${d})`;
  });
  return cols;
}
const latestIso = (days: readonly string[]): string =>
  days.reduce((a, b) => (b > a ? b : a));

/**
 * The `asOf` path, for one or more days: same derivation, but every scan is
 * bounded by the date. Several days share ONE activity scan and ONE freshness
 * scan (2026-11: the Dashboard's status flow reconstructs two days and paid
 * four scans for them); the result is one map per day, in `days` order.
 */
async function creativeStatusMapsAsOf(
  creativeIds: string[] | undefined,
  days: readonly string[],
): Promise<Map<string, CreativeStatusResult>[]> {
  if ((creativeIds && creativeIds.length === 0) || days.length === 0) {
    return days.map(() => new Map());
  }
  const restrict = Boolean(creativeIds && creativeIds.length > 0);
  const [acct, windowHours] = await Promise.all([
    getActiveAccountId(),
    getActiveStatusWindowHours(),
  ]);
  const windowDays = hoursToWindowDays(windowHours);
  const until = latestIso(days);

  const activity = await db
    .select({
      creativeId: performanceRecords.creativeId,
      platform: performanceRecords.platform,
      ...maxDateAsOf(days),
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.excludedFromAggregates, false),
        sql`${performanceRecords.spend} > 0`,
        sql`${performanceRecords.date} <= ${until}`,
        ...(restrict ? [inArray(performanceRecords.creativeId, creativeIds!)] : []),
      ),
    )
    .groupBy(performanceRecords.creativeId, performanceRecords.platform);

  const freshness = await db
    .select({
      platform: performanceRecords.platform,
      ...maxDateAsOf(days),
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.excludedFromAggregates, false),
        sql`${performanceRecords.spend} > 0`,
        sql`${performanceRecords.date} <= ${until}`,
      ),
    )
    .groupBy(performanceRecords.platform);

  // Terminations in force on each day — the cached brand read, filtered by day
  // here instead of a date-bounded query per call (the activity and freshness
  // scans above stay date-bounded: they ARE the reconstruction).
  const keep = restrict ? new Set(creativeIds) : null;
  const allOverrides = await brandOverrides();

  return days.map((asOf, i) => {
    const key = `d${i}`;
    const dayActivity: BrandStatusInputs["activity"] = [];
    for (const a of activity) {
      const lastDate = (a as Record<string, unknown>)[key] as string | null;
      if (lastDate) dayActivity.push({ creativeId: a.creativeId, platform: a.platform, lastDate });
    }
    const latestDayByPlatform: Partial<Record<Platform, string>> = {};
    for (const f of freshness) {
      const lastDate = (f as Record<string, unknown>)[key] as string | null;
      if (lastDate) latestDayByPlatform[f.platform as Platform] = lastDate;
    }
    const overrides = allOverrides.filter(
      (o) => o.terminatedOn <= asOf && (!keep || keep.has(o.creativeId)),
    );
    return buildStatusMap(dayActivity, overrides, { latestDayByPlatform, windowDays }, null);
  });
}

/** Look up a creative's status, defaulting to "new" when absent from the map. */
export function statusFor(
  map: Map<string, CreativeStatusResult>,
  creativeId: string,
): CreativeStatusResult {
  return map.get(creativeId) ?? NEW_STATUS;
}

/**
 * Just the per-platform termination set for one creative (for the detail UI)
 * — from the request's ONE cached overrides read, which the creative's status
 * map reads anyway (W2-4, 2026-10: it was its own query on every detail view).
 */
export async function terminatedPlatformsFor(
  creativeId: string,
): Promise<Platform[]> {
  return (await brandOverrides())
    .filter((o) => o.creativeId === creativeId)
    .map((o) => o.platform as Platform);
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
  angles?: string[];
}

/** Creative IDs matching the product/type/angle filters (account-scoped), or
 *  undefined when none of those filters are set (→ whole brand). */
async function statusRestrictIds(
  filters: StatusTransitionFilters,
): Promise<string[] | undefined> {
  const hasAttr =
    (filters.productIds && filters.productIds.length > 0) ||
    (filters.types && filters.types.length > 0) ||
    (filters.angles && filters.angles.length > 0);
  if (!hasAttr) return undefined;

  const acct = await getActiveAccountId();
  const conds: SQL[] = [eq(creatives.accountId, acct)];
  if (filters.productIds && filters.productIds.length > 0) {
    conds.push(inArray(creatives.productId, filters.productIds));
  }
  if (filters.types && filters.types.length > 0) {
    conds.push(inArray(creatives.type, filters.types));
  }
  if (filters.angles && filters.angles.length > 0) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${creativeAngles} WHERE ${creativeAngles.creativeId} = ${creatives.id} AND ${inArray(creativeAngles.angle, filters.angles)})`,
    );
  }
  const rows = await db.select({ id: creatives.id }).from(creatives).where(and(...conds));
  return rows.map((r) => r.id);
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

/** Platforms shown in the status-flow grid — the canonical list, derived. */
export const FLOW_PLATFORMS: Platform[] = [...platformEnum];

export interface StatusFlowScope {
  /** Platform value or campaign name. */
  key: string;
  data: CreativeStatusTransitions;
}

const isoMinusDays = (iso: string, days: number): string => shiftIso(iso, -days);

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
    // Both days in one reconstruction pass (two scans, not four).
    const [startMap, endMap] = (await creativeStatusMapsAsOf(restrictIds, [
      isoMinusOneDay(filters.from),
      filters.to,
    ])) as [Map<string, CreativeStatusResult>, Map<string, CreativeStatusResult>];
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
      campaign: campaigns.name,
      spend: sql<number>`SUM(${performanceRecords.spend})`,
    })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(and(...scopeConds([between(performanceRecords.date, filters.from, filters.to)])))
    .groupBy(campaigns.id)
    .orderBy(desc(sql`SUM(${performanceRecords.spend})`))
    .limit(4);
  const campaignNames = topRows.map((r) => r.campaign);
  if (campaignNames.length === 0) return [];

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

  // Both as-of days in one pass each (2026-11: four queries → two) — the
  // FILTERed MAX per day is what a `date <= day` query per day returns.
  const asOfDays = [startAsOf, endAsOf] as const;
  const until = latestIso(asOfDays);

  // P's freshness anchor at each as-of (latest SPEND day ≤ as-of).
  const [anchors] = await db
    .select(maxDateAsOf(asOfDays))
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.platform, P),
        eq(performanceRecords.excludedFromAggregates, false),
        sql`${performanceRecords.spend} > 0`,
        sql`${performanceRecords.date} <= ${until}`,
      ),
    );
  const startAnchor = (anchors?.d0 as string | null | undefined) ?? null;
  const endAnchor = (anchors?.d1 as string | null | undefined) ?? null;

  // Per-(creative, campaign) last spend date on P, as of each day.
  const spendRows = await db
    .select({
      creativeId: performanceRecords.creativeId,
      campaign: campaigns.name,
      ...maxDateAsOf(asOfDays),
    })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(
      and(
        ...scopeConds([
          inArray(campaigns.name, campaignNames),
          sql`${performanceRecords.spend} > 0`,
          sql`${performanceRecords.date} <= ${until}`,
        ]),
      ),
    )
    .groupBy(performanceRecords.creativeId, campaigns.id);
  const lastSpendAsOf = (key: "d0" | "d1"): Map<string, Map<string, string>> => {
    const m = new Map<string, Map<string, string>>();
    for (const r of spendRows) {
      const last = (r as Record<string, unknown>)[key] as string | null;
      if (!last) continue;
      let cm = m.get(r.campaign);
      if (!cm) {
        cm = new Map();
        m.set(r.campaign, cm);
      }
      cm.set(r.creativeId, last);
    }
    return m;
  };
  const startSpend = lastSpendAsOf("d0");
  const endSpend = lastSpendAsOf("d1");

  const statusOf = (
    last: string | undefined,
    anchor: string | null,
  ): CreativeStatus => {
    if (!last) return "new";
    if (!anchor) return "pause";
    return last >= isoMinusDays(anchor, windowDays - 1) ? "active" : "pause";
  };

  return campaignNames.map((c) => {
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
