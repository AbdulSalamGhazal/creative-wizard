import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords, platformEnum } from "@/db/schema";
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
 * Latest record date per platform for the active account — the freshness anchor
 * for a per-platform chart line (mirrors the per-platform anchoring in
 * `db/queries/creative-status.ts`). A platform absent from the map has no data.
 */
export const platformHorizons = cache(
  async (): Promise<Partial<Record<Platform, string>>> => {
    const acct = await getActiveAccountId();
    const rows = await db
      .select({
        platform: performanceRecords.platform,
        max: sql<string>`MAX(${performanceRecords.date})`,
      })
      .from(performanceRecords)
      .where(eq(performanceRecords.accountId, acct))
      .groupBy(performanceRecords.platform);
    const out: Partial<Record<Platform, string>> = {};
    for (const r of rows) out[r.platform as Platform] = r.max;
    return out;
  },
);

/** First-ever record date for one campaign (unbounded by any window), or null. */
export async function campaignFirstDay(
  campaignId: string,
): Promise<string | null> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ min: sql<string | null>`MIN(${performanceRecords.date})` })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.campaignId, campaignId),
      ),
    );
  return row?.min ?? null;
}

/** First-ever record date PER PLATFORM for one creative (unbounded), account-scoped. */
export async function creativePlatformFirstDays(
  creativeId: string,
): Promise<Partial<Record<Platform, string>>> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      min: sql<string>`MIN(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.creativeId, creativeId),
      ),
    )
    .groupBy(performanceRecords.platform);
  const out: Partial<Record<Platform, string>> = {};
  for (const r of rows) out[r.platform as Platform] = r.min;
  return out;
}

/** First-ever record date across ALL of one creative's records (any platform). */
export async function creativeFirstDay(
  creativeId: string,
): Promise<string | null> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ min: sql<string | null>`MIN(${performanceRecords.date})` })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.creativeId, creativeId),
      ),
    );
  return row?.min ?? null;
}

/** ISO min/max helpers — YYYY-MM-DD sorts lexicographically. Null = "unbounded". */
export function isoMin(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}
export function isoMax(a: string | null, b: string | null): string | null {
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
