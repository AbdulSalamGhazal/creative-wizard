import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  performanceRecords,
  platformEnum,
  storeOrders,
  storeSourceMappings,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { sumConversions, sumSpend } from "@/lib/metrics";

/**
 * Store → Reconciliation queries. Compares store ORDER COUNTS (from
 * `store_orders`) against platform-claimed CONVERSIONS (from
 * `performance_records`) per day. COUNTS ONLY — no revenue is ever compared;
 * store revenue (SAR) and spend (USD) are surfaced only as optional context
 * columns, never diffed. Account-scoped (§4.1); the ads side always respects
 * `excluded_from_aggregates = false`, like every other aggregation.
 */

export type ReconPlatform = (typeof platformEnum)[number];

/** Sentinel bucket for store orders not attributed to any ad platform. */
export const UNATTRIBUTED = "__unattr__";

export interface ReconOverviewRow {
  day: string;
  storeOrders: number;
  platformConv: number;
  /** Context only (hidden by default) — never compared to spend. */
  storeRevenue: number;
  /** Context only (hidden by default) — never compared to revenue. */
  spend: number;
}

export interface ReconByPlatformRow {
  day: string;
  /** platform → store-order count whose source maps to it. */
  storeByPlatform: Record<string, number>;
  /** platform → claimed conversions. */
  claimedByPlatform: Record<string, number>;
  /** Store orders whose source is unmapped / "not an ad platform" / empty. */
  unattributed: number;
  /** Total store orders that day (== sum of buckets + unattributed). */
  storeOrders: number;
}

// ── Config: source field + value mappings ────────────────────────────────────

/** The account's configured source field key (`store_order_fields.key`), or null. */
export async function getStoreSourceFieldKey(): Promise<string | null> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ key: sql<string | null>`store_source_field_key` })
    .from(sql`accounts`)
    .where(sql`id = ${acct}`)
    .limit(1);
  return row?.key ?? null;
}

/** Every source-value → platform mapping for the active account. */
export async function listStoreSourceMappings(): Promise<
  Array<{ id: string; rawValue: string; platform: ReconPlatform | null }>
> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: storeSourceMappings.id,
      rawValue: storeSourceMappings.rawValue,
      platform: storeSourceMappings.platform,
    })
    .from(storeSourceMappings)
    .where(eq(storeSourceMappings.accountId, acct));
  return rows.map((r) => ({
    id: r.id,
    rawValue: r.rawValue,
    platform: (r.platform as ReconPlatform | null) ?? null,
  }));
}

/**
 * The DISTINCT raw values actually present in uploaded orders' `attributes` for
 * the given field key, with their frequency (desc), capped. Feeds the config
 * UI's mapping list. Returns [] when the field key is empty.
 */
export async function distinctStoreSourceValues(
  fieldKey: string | null,
  cap = 200,
): Promise<Array<{ value: string; count: number }>> {
  if (!fieldKey) return [];
  const acct = await getActiveAccountId();
  const valueExpr = sql<string>`${storeOrders.attributes} ->> ${fieldKey}`;
  const rows = await db
    .select({
      value: valueExpr,
      count: sql<number>`count(*)::int`,
    })
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.accountId, acct),
        sql`${valueExpr} IS NOT NULL`,
        sql`${valueExpr} <> ''`,
      ),
    )
    // GROUP BY ordinal: the derived `attributes ->> key` expression carries a
    // bind param, and drizzle re-serializes it (a fresh param) if repeated in
    // GROUP BY — Postgres then won't match it to the SELECT. Ordinal sidesteps it.
    .groupBy(sql`1`)
    .orderBy(sql`count(*) DESC`)
    .limit(cap);
  return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
}

// ── Reconciliation reads ─────────────────────────────────────────────────────

function storeConds(acct: string, from?: string, to?: string) {
  const c = [eq(storeOrders.accountId, acct)];
  if (from) c.push(gte(storeOrders.orderDate, from));
  if (to) c.push(lte(storeOrders.orderDate, to));
  return c;
}

function adsConds(acct: string, from?: string, to?: string) {
  const c = [
    eq(performanceRecords.accountId, acct),
    eq(performanceRecords.excludedFromAggregates, false),
  ];
  if (from) c.push(gte(performanceRecords.date, from));
  if (to) c.push(lte(performanceRecords.date, to));
  return c;
}

/**
 * Overview rows: one per day where EITHER side has data, DESC. Store orders +
 * revenue on one side, all-platform conversions + spend on the other, merged by
 * date. Both-empty days are omitted (they never appear in either scan).
 */
export async function reconciliationOverview(
  from?: string,
  to?: string,
): Promise<ReconOverviewRow[]> {
  const acct = await getActiveAccountId();
  const [storeRows, adsRows] = await Promise.all([
    db
      .select({
        day: storeOrders.orderDate,
        orders: sql<number>`count(*)::int`,
        revenue: sql<string | null>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
      })
      .from(storeOrders)
      .where(and(...storeConds(acct, from, to)))
      .groupBy(storeOrders.orderDate),
    db
      .select({
        day: performanceRecords.date,
        conv: sumConversions,
        spend: sumSpend,
      })
      .from(performanceRecords)
      .where(and(...adsConds(acct, from, to)))
      .groupBy(performanceRecords.date),
  ]);

  const byDay = new Map<string, ReconOverviewRow>();
  for (const r of storeRows) {
    byDay.set(r.day, {
      day: r.day,
      storeOrders: Number(r.orders),
      platformConv: 0,
      storeRevenue: Number(r.revenue ?? 0),
      spend: 0,
    });
  }
  for (const r of adsRows) {
    const existing = byDay.get(r.day);
    if (existing) {
      existing.platformConv = Number(r.conv ?? 0);
      existing.spend = Number(r.spend ?? 0);
    } else {
      byDay.set(r.day, {
        day: r.day,
        storeOrders: 0,
        platformConv: Number(r.conv ?? 0),
        storeRevenue: 0,
        spend: Number(r.spend ?? 0),
      });
    }
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * By-platform rows: per day, store-order counts bucketed by the platform their
 * source value maps to (+ an Unattributed bucket) and claimed conversions per
 * platform. The buckets RECONCILE: sum(storeByPlatform) + unattributed ==
 * overview store orders, because the `(account_id, raw_value)` mapping is unique
 * (no fan-out) and every order LEFT-JOINs to at most one mapping row.
 *
 * `sourceFieldKey` must be non-null (the caller shows a not-configured state
 * otherwise). When it's null this returns [] to be safe.
 */
export async function reconciliationByPlatform(
  sourceFieldKey: string | null,
  from?: string,
  to?: string,
): Promise<ReconByPlatformRow[]> {
  const acct = await getActiveAccountId();
  if (!sourceFieldKey) return [];

  // COALESCE(mapping.platform, sentinel): a value mapped to "not an ad platform"
  // (platform NULL) and an unmapped value both fall through to Unattributed.
  const bucketExpr = sql<string>`COALESCE(${storeSourceMappings.platform}, ${UNATTRIBUTED})`;
  const [storeRows, adsRows] = await Promise.all([
    db
      .select({
        day: storeOrders.orderDate,
        bucket: bucketExpr,
        n: sql<number>`count(*)::int`,
      })
      .from(storeOrders)
      .leftJoin(
        storeSourceMappings,
        and(
          eq(storeSourceMappings.accountId, acct),
          sql`${storeSourceMappings.rawValue} = (${storeOrders.attributes} ->> ${sourceFieldKey})`,
        ),
      )
      .where(and(...storeConds(acct, from, to)))
      // GROUP BY ordinal (day, bucket) — see distinctStoreSourceValues: the
      // COALESCE(platform, …) bucket expression carries a bind param drizzle
      // would re-serialize, breaking GROUP BY matching.
      .groupBy(sql`1, 2`),
    db
      .select({
        day: performanceRecords.date,
        platform: performanceRecords.platform,
        conv: sumConversions,
      })
      .from(performanceRecords)
      .where(and(...adsConds(acct, from, to)))
      .groupBy(performanceRecords.date, performanceRecords.platform),
  ]);

  const byDay = new Map<string, ReconByPlatformRow>();
  const ensure = (day: string): ReconByPlatformRow => {
    let row = byDay.get(day);
    if (!row) {
      row = {
        day,
        storeByPlatform: {},
        claimedByPlatform: {},
        unattributed: 0,
        storeOrders: 0,
      };
      byDay.set(day, row);
    }
    return row;
  };

  for (const r of storeRows) {
    const row = ensure(r.day);
    const n = Number(r.n);
    row.storeOrders += n;
    if (r.bucket === UNATTRIBUTED) row.unattributed += n;
    else row.storeByPlatform[r.bucket] = (row.storeByPlatform[r.bucket] ?? 0) + n;
  }
  for (const r of adsRows) {
    const row = ensure(r.day);
    row.claimedByPlatform[r.platform] =
      (row.claimedByPlatform[r.platform] ?? 0) + Number(r.conv ?? 0);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * Each platform's latest ads data day (MAX date with spend > 0, non-excluded)
 * — the "data horizon". A reconciliation day within 7 days of a horizon is
 * still attributing, so a recent store>claimed gap isn't a real discrepancy.
 * Reuses the freshness scan from the creative/campaign status work.
 */
export async function platformDataHorizons(): Promise<
  Partial<Record<ReconPlatform, string>>
> {
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
  const out: Partial<Record<ReconPlatform, string>> = {};
  for (const r of rows) out[r.platform as ReconPlatform] = r.lastDate;
  return out;
}
