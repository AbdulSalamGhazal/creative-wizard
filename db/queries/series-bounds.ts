import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords, platformEnum, storeOrders } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

type Platform = (typeof platformEnum)[number];

/**
 * Edge bounds for time-series gap filling (see `lib/time-series.ts`). A
 * currently-paused entity should show trailing zeros up to the DATA HORIZON —
 * the latest date that has ANY performance record — but never past it (days
 * after the newest upload are unknown, not zero).
 *
 * `cache()`-wrapped like `lib/tenant.ts` so several charts on one page share a
 * single horizon lookup per request. Bounds are computed over ALL records
 * (including excluded) — the horizon is "how fresh is our data", independent of
 * whether a given row is excluded from aggregates.
 */

/** Latest record date for the active account (the data horizon), or null. */
export const dataHorizon = cache(async (): Promise<string | null> => {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ max: sql<string | null>`MAX(${performanceRecords.date})` })
    .from(performanceRecords)
    .where(eq(performanceRecords.accountId, acct));
  return row?.max ?? null;
});

/**
 * Latest STORE order date for the active account — the store module's own data
 * horizon, independent of the ads one.
 *
 * The two pipelines are uploaded separately, so their freshness differs: a
 * brand can have this month's orders but no ad exports yet, or vice versa.
 * Anything showing both sides per day (Budget Pacing) must gate each side by
 * its OWN horizon, or one empty pipeline blanks out the other's real data.
 * `cache()`-wrapped like `dataHorizon` so one page pays for one lookup.
 */
export const storeDataHorizon = cache(async (): Promise<string | null> => {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ max: sql<string | null>`MAX(${storeOrders.orderDate})` })
    .from(storeOrders)
    .where(eq(storeOrders.accountId, acct));
  return row?.max ?? null;
});

/**
 * Latest record date per platform for the active account — the freshness anchor
 * for a per-platform chart line (mirrors the per-platform anchoring in
 * `db/queries/creative-status.ts`). A platform absent from the map has no data.
 */
export const platformHorizons = cache(
  async (): Promise<Partial<Record<Platform, string>>> => {
    const acct = await getActiveAccountId();
    // ONE index probe per platform (W2-9, 2026-10) — `perf_account_platform_
    // date_idx` answers each MAX from its last entry. The GROUP BY it replaces
    // read every row of the brand (a seq scan at 54k synthetic rows: ~20 ms
    // → ~0.1 ms).
    const rows = await db.execute<{ platform: string; max: string | null }>(sql`
      SELECT p.platform,
             (SELECT MAX(${performanceRecords.date}) FROM ${performanceRecords}
               WHERE ${performanceRecords.accountId} = ${acct}
                 AND ${performanceRecords.platform} = p.platform)::text AS max
        FROM unnest(${sql.param([...platformEnum])}::varchar[]) AS p(platform)`);
    const out: Partial<Record<Platform, string>> = {};
    for (const r of rows) if (r.max) out[r.platform as Platform] = r.max;
    return out;
  },
);

/** Every record of one creative (excluded included), summarized. */
export interface CreativeRecordSpans {
  /** Per platform: record count and first/last day, ordered by platform. */
  byPlatform: Array<{ platform: Platform; records: number; firstDate: string; lastDate: string }>;
  /** Distinct campaigns across all of the creative's records. */
  campaigns: number;
}

/**
 * One creative's record spans, in ONE read, `cache()`-shared per request
 * (2026-11): the detail page's analytics body needs each platform's first day
 * and its danger zone needs the counts, the date range and the distinct
 * campaigns — three reads of the same rows before. `GROUPING SETS` gives the
 * per-platform rows plus a grand-total row (the only place a DISTINCT count
 * across platforms can come from). Account-scoped for defence in depth.
 */
export const creativeRecordSpans = cache(
  async (creativeId: string): Promise<CreativeRecordSpans> => {
    const acct = await getActiveAccountId();
    const rows = await db
      .select({
        platform: performanceRecords.platform,
        isTotal: sql<number>`GROUPING(${performanceRecords.platform})`,
        records: sql<number>`COUNT(*)::int`,
        firstDate: sql<string>`MIN(${performanceRecords.date})`,
        lastDate: sql<string>`MAX(${performanceRecords.date})`,
        campaigns: sql<number>`COUNT(DISTINCT ${performanceRecords.campaignId})::int`,
      })
      .from(performanceRecords)
      .where(
        and(
          eq(performanceRecords.accountId, acct),
          eq(performanceRecords.creativeId, creativeId),
        ),
      )
      .groupBy(sql`GROUPING SETS ((${performanceRecords.platform}), ())`)
      .orderBy(performanceRecords.platform);
    const byPlatform: CreativeRecordSpans["byPlatform"] = [];
    let campaigns = 0;
    for (const r of rows) {
      if (Number(r.isTotal) === 1) {
        campaigns = Number(r.campaigns);
        continue;
      }
      byPlatform.push({
        platform: r.platform as Platform,
        records: Number(r.records),
        firstDate: r.firstDate,
        lastDate: r.lastDate,
      });
    }
    return { byPlatform, campaigns };
  },
);

/** First-ever record date PER PLATFORM for one creative (unbounded), account-scoped. */
export async function creativePlatformFirstDays(
  creativeId: string,
): Promise<Partial<Record<Platform, string>>> {
  const out: Partial<Record<Platform, string>> = {};
  for (const r of (await creativeRecordSpans(creativeId)).byPlatform) {
    out[r.platform] = r.firstDate;
  }
  return out;
}

/**
 * The earliest / latest ISO date in a per-platform map, or null when empty.
 * The brand-wide data horizon IS the latest platform horizon, and a filter
 * set's first day the earliest of its per-platform first days — so a page that
 * already holds the per-platform map derives the single value instead of
 * querying it again (W2-3, 2026-10).
 */
export function earliestOf(byPlatform: Partial<Record<string, string>>): string | null {
  let out: string | null = null;
  for (const v of Object.values(byPlatform)) if (v && (out === null || v < out)) out = v;
  return out;
}
export function latestOf(byPlatform: Partial<Record<string, string>>): string | null {
  let out: string | null = null;
  for (const v of Object.values(byPlatform)) if (v && (out === null || v > out)) out = v;
  return out;
}

/** ISO min/max helpers — YYYY-MM-DD sorts lexicographically. Null = "unbounded". */
function isoMin(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}
function isoMax(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * Resolve the leading/trailing fill bounds for an entity-total series:
 * `fillFrom = max(requested from, entity first-ever)`,
 * `fillTo   = min(requested to, data horizon)`.
 * Nulls (no data) become undefined → no edge fill on that side.
 */
export function resolveEntityBounds(opts: {
  from: string | null | undefined;
  to: string | null | undefined;
  firstEver: string | null;
  horizon: string | null;
}): { fillFrom?: string; fillTo?: string } {
  const from = opts.from ?? null;
  const to = opts.to ?? null;
  const fillFrom = isoMax(from, opts.firstEver);
  const fillTo = isoMin(to, opts.horizon);
  return {
    fillFrom: fillFrom ?? undefined,
    fillTo: fillTo ?? undefined,
  };
}

/**
 * Per-platform variant of `resolveEntityBounds` for a chart that draws one line
 * per platform (creative detail): each platform trails to its OWN horizon and
 * leads from its OWN first-ever day, both clamped to the requested window. Only
 * platforms present in `firstDays` get a leading bound; only those in `horizons`
 * get a trailing one.
 */
export function resolvePlatformBounds(opts: {
  from: string | null | undefined;
  to: string | null | undefined;
  firstDays: Partial<Record<Platform, string>>;
  horizons: Partial<Record<Platform, string>>;
}): {
  fillFrom: Partial<Record<Platform, string>>;
  fillTo: Partial<Record<Platform, string>>;
} {
  const from = opts.from ?? null;
  const to = opts.to ?? null;
  const fillFrom: Partial<Record<Platform, string>> = {};
  const fillTo: Partial<Record<Platform, string>> = {};
  for (const [p, first] of Object.entries(opts.firstDays)) {
    const v = isoMax(from, first ?? null);
    if (v) fillFrom[p as Platform] = v;
  }
  for (const [p, horizon] of Object.entries(opts.horizons)) {
    const v = isoMin(to, horizon ?? null);
    if (v) fillTo[p as Platform] = v;
  }
  return { fillFrom, fillTo };
}
