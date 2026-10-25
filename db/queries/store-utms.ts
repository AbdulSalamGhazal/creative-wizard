import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  performanceRecords,
  storeChannelMappings,
  storeOrders,
  storeSourceMappings,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { sumConversions } from "@/lib/metrics";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { STORE_CHANNEL_FIELD_KEY } from "@/store/channels";
import { NO_SOURCE, OTHER_SOURCE, UNMAPPED_SOURCE } from "@/store/sources";
import { BREAKDOWN_GROUP_CAP } from "@/db/queries/store-insights";
import type { PlatformKey } from "@/lib/palette";
import type { UtmBucket, UtmBucketDay, UtmSourceRow } from "@/lib/store-utms";

export type { UtmSourceRow };

/**
 * Store → UTMs queries. FOUR scans per render, each bounded by the resolved
 * range and account-scoped (§4.1):
 *  1. per day × bucket            — the coverage KPIs and the stacked trend;
 *  2. per source value (totals)   — the Sources table, the hygiene lists and
 *                                   the compare picker's options;
 *  3. per day × top-N source      — the compare lines and the per-source trend;
 *  4. per day × platform, claimed — the accuracy section's ads side.
 * `lib/db.ts` is `max: 1`, so every extra query is a serial round-trip; nothing
 * here is fetched per value.
 *
 * BUCKETING IS RECONCILIATION'S. The source join is the same LEFT JOIN on the
 * unique `(account_id, raw_value)` mapping — no fan-out, every order lands in
 * exactly one bucket — and the platform buckets are the same expression. The
 * only difference is that Reconciliation's Unattributed is split three ways
 * (no source · unmapped value · "not an ad platform"); their sum equals it,
 * pinned in `tests/db/store-utms.test.ts`.
 *
 * CONTRACT for every `from`/`to`: callers pass RESOLVED bounds (the page
 * resolves URL → saved range → the default before calling), as every store
 * page does — raw optional params would leave the conditions unbound.
 */

/** `attributes ->> utm_source`, blank normalized to NULL. */
const sourceExpr = sql<string | null>`NULLIF(${storeOrders.attributes} ->> ${STORE_SOURCE_FIELD_KEY}, '')`;

/**
 * The four-way bucket: no source → NO_SOURCE; a value with no mapping row →
 * UNMAPPED_SOURCE; mapped to platform NULL ("not an ad platform") →
 * OTHER_SOURCE; else the platform. The first two arms are what Reconciliation
 * folds into Unattributed together with the third.
 */
const bucketExpr = sql<string>`CASE
  WHEN ${sourceExpr} IS NULL THEN ${NO_SOURCE}
  WHEN ${storeSourceMappings.rawValue} IS NULL THEN ${UNMAPPED_SOURCE}
  WHEN ${storeSourceMappings.platform} IS NULL THEN ${OTHER_SOURCE}
  ELSE ${storeSourceMappings.platform}
END`;

function sourceJoinOn(acct: string) {
  return and(
    eq(storeSourceMappings.accountId, acct),
    sql`${storeSourceMappings.rawValue} = (${storeOrders.attributes} ->> ${STORE_SOURCE_FIELD_KEY})`,
  );
}

function channelJoinOn(acct: string) {
  return and(
    eq(storeChannelMappings.accountId, acct),
    sql`${storeChannelMappings.rawValue} = (${storeOrders.attributes} ->> ${STORE_CHANNEL_FIELD_KEY})`,
  );
}

function storeConds(acct: string, from: string, to: string): SQL[] {
  return [
    eq(storeOrders.accountId, acct),
    gte(storeOrders.orderDate, from),
    lte(storeOrders.orderDate, to),
  ];
}

// ── 1. Per day × bucket ──────────────────────────────────────────────────────

export async function utmDailyByBucket(from: string, to: string): Promise<UtmBucketDay[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      day: storeOrders.orderDate,
      bucket: bucketExpr,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
    })
    .from(storeOrders)
    .leftJoin(storeSourceMappings, sourceJoinOn(acct))
    .where(and(...storeConds(acct, from, to)))
    // GROUP BY ordinal: the bucket expression carries bind params drizzle
    // would re-serialize, breaking GROUP BY matching (the store scans' note).
    .groupBy(sql`1, 2`)
    .orderBy(storeOrders.orderDate);
  return rows.map((r) => ({
    day: r.day,
    bucket: r.bucket as UtmBucket,
    orders: Number(r.orders),
    revenue: Number(r.revenue ?? 0),
  }));
}

// ── 2. Per source value ──────────────────────────────────────────────────────

export interface UtmSourceBreakdown {
  rows: UtmSourceRow[];
  /** Distinct values in range BEFORE the cap — `> rows.length` when truncated. */
  totalValues: number;
}

/**
 * ONE GROUP BY over the raw source value, largest first, capped at
 * `BREAKDOWN_GROUP_CAP` (a free-text field can have as many values as orders).
 * The channel split rides along as two FILTERed counts — the same unique
 * channel mapping Reconciliation uses, so Website here is Website there.
 */
export async function utmSourceBreakdown(from: string, to: string): Promise<UtmSourceBreakdown> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      value: sourceExpr,
      bucket: bucketExpr,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
      website: sql<number>`count(*) FILTER (WHERE ${storeChannelMappings.destination} = 'website')::int`,
      application: sql<number>`count(*) FILTER (WHERE ${storeChannelMappings.destination} = 'application')::int`,
      totalValues: sql<number>`count(*) OVER ()::int`,
    })
    .from(storeOrders)
    .leftJoin(storeSourceMappings, sourceJoinOn(acct))
    .leftJoin(storeChannelMappings, channelJoinOn(acct))
    .where(and(...storeConds(acct, from, to)))
    .groupBy(sql`1, 2`)
    .orderBy(sql`3 DESC`)
    .limit(BREAKDOWN_GROUP_CAP);
  return {
    rows: rows.map((r) => ({
      value: r.value === null ? null : String(r.value),
      bucket: r.bucket as UtmBucket,
      orders: Number(r.orders),
      revenue: Number(r.revenue ?? 0),
      website: Number(r.website),
      application: Number(r.application),
    })),
    totalValues: rows.length > 0 ? Number(rows[0]!.totalValues) : 0,
  };
}

// ── 3. Per day × source, for the chosen values ───────────────────────────────

export interface UtmSourceDay {
  day: string;
  value: string | null;
  orders: number;
  revenue: number;
}

/**
 * Per-day orders + revenue for the GIVEN source values only (the top N from
 * the breakdown, so the payload is bounded by N × days, never by the long
 * tail). `null` in the list asks for the blank bucket's series too.
 */
export async function utmSourceDaily(
  from: string,
  to: string,
  values: ReadonlyArray<string | null>,
): Promise<UtmSourceDay[]> {
  const named = values.filter((v): v is string => v !== null);
  const wantBlank = values.some((v) => v === null);
  if (named.length === 0 && !wantBlank) return [];
  const acct = await getActiveAccountId();
  const pick: SQL[] = [];
  if (named.length > 0) pick.push(inArray(sourceExpr, named));
  if (wantBlank) pick.push(isNull(sourceExpr));
  const rows = await db
    .select({
      day: storeOrders.orderDate,
      value: sourceExpr,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
    })
    .from(storeOrders)
    .where(and(...storeConds(acct, from, to), pick.length === 1 ? pick[0] : or(...pick)))
    .groupBy(sql`1, 2`)
    // Day, then value (NULLs last) — a stable order the client can rely on.
    .orderBy(sql`1, 2`);
  return rows.map((r) => ({
    day: r.day,
    value: r.value === null ? null : String(r.value),
    orders: Number(r.orders),
    revenue: Number(r.revenue ?? 0),
  }));
}

// ── 4. Claimed conversions per day × platform ────────────────────────────────

export interface UtmClaimedDay {
  day: string;
  platform: PlatformKey;
  conversions: number;
}

/**
 * The ads side: SUM(conversions) per day per platform over the range, hiding
 * `excluded_from_aggregates` rows unless the resolved Excluded toggle opts in
 * — the same scan Reconciliation's by-platform read runs.
 */
export async function utmClaimedDaily(
  from: string,
  to: string,
  includeExcluded: boolean,
): Promise<UtmClaimedDay[]> {
  const acct = await getActiveAccountId();
  const conds: SQL[] = [
    eq(performanceRecords.accountId, acct),
    gte(performanceRecords.date, from),
    lte(performanceRecords.date, to),
  ];
  if (!includeExcluded) conds.push(eq(performanceRecords.excludedFromAggregates, false));
  const rows = await db
    .select({
      day: performanceRecords.date,
      platform: performanceRecords.platform,
      conversions: sumConversions,
    })
    .from(performanceRecords)
    .where(and(...conds))
    .groupBy(performanceRecords.date, performanceRecords.platform)
    .orderBy(performanceRecords.date);
  return rows.map((r) => ({
    day: r.day,
    platform: r.platform as PlatformKey,
    conversions: Number(r.conversions ?? 0),
  }));
}
