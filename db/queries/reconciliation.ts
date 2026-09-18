import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  performanceRecords,
  platformEnum,
  storeChannelMappings,
  storeOrders,
  storeSourceMappings,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { sumConversions, sumSpend } from "@/lib/metrics";
import {
  STORE_CHANNEL_FIELD_KEY,
  UNMAPPED_CHANNEL,
  type ChannelDestination,
} from "@/store/channels";

/**
 * Store → Reconciliation queries. Compares store ORDER COUNTS (from
 * `store_orders`) against platform-claimed CONVERSIONS (from
 * `performance_records`) per day. COUNTS ONLY — no revenue is ever compared;
 * store revenue (SAR) and spend (USD) are surfaced only as optional context
 * columns, never diffed. Account-scoped (§4.1); the ads side hides
 * `excluded_from_aggregates` rows by default, honoring the shared Excluded
 * toggle via `includeExcluded` like every other aggregation.
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

/**
 * The by-platform scan's output: the per-day rows, plus the DISTINCT raw source
 * values in range that no mapping covers. The unmapped set falls out of the
 * same scan, so the page no longer runs a separate unbounded DISTINCT over
 * every order the brand has ever had just to decide whether to show a banner.
 */
export interface ReconByPlatformResult {
  rows: ReconByPlatformRow[];
  /** Distinct non-empty raw values in range with no `store_source_mappings` row. */
  unmappedValues: string[];
}

/** Per-day channel roll-up: where the purchase happened vs what platforms claim. */
export interface ReconByChannelRow {
  day: string;
  /** Orders whose channel maps to Website. */
  website: number;
  /** Orders whose channel maps to Application. */
  application: number;
  /** Orders whose channel has NO mapping (or is blank) — never absorbed. */
  unmapped: number;
  /** Total store orders that day (== website + application + unmapped). */
  storeOrders: number;
}

export interface ReconByChannelResult {
  rows: ReconByChannelRow[];
  /** Distinct non-empty raw channel values in range with no mapping row. */
  unmappedValues: string[];
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

/** Every channel-value → destination mapping for the active account. */
export async function listStoreChannelMappings(): Promise<
  Array<{ id: string; rawValue: string; destination: ChannelDestination }>
> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: storeChannelMappings.id,
      rawValue: storeChannelMappings.rawValue,
      destination: storeChannelMappings.destination,
    })
    .from(storeChannelMappings)
    .where(eq(storeChannelMappings.accountId, acct));
  return rows.map((r) => ({
    id: r.id,
    rawValue: r.rawValue,
    destination: r.destination as ChannelDestination,
  }));
}

// ── Reconciliation reads ─────────────────────────────────────────────────────

function storeConds(acct: string, from?: string, to?: string) {
  const c = [eq(storeOrders.accountId, acct)];
  if (from) c.push(gte(storeOrders.orderDate, from));
  if (to) c.push(lte(storeOrders.orderDate, to));
  return c;
}

function adsConds(
  acct: string,
  from?: string,
  to?: string,
  includeExcluded?: boolean,
) {
  const c = [eq(performanceRecords.accountId, acct)];
  if (!includeExcluded) {
    c.push(eq(performanceRecords.excludedFromAggregates, false));
  }
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
  includeExcluded?: boolean,
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
      .where(and(...adsConds(acct, from, to, includeExcluded)))
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
  includeExcluded?: boolean,
): Promise<ReconByPlatformResult> {
  const acct = await getActiveAccountId();
  if (!sourceFieldKey) return { rows: [], unmappedValues: [] };

  // COALESCE(mapping.platform, sentinel): a value mapped to "not an ad platform"
  // (platform NULL) and an unmapped value both fall through to Unattributed.
  const bucketExpr = sql<string>`COALESCE(${storeSourceMappings.platform}, ${UNATTRIBUTED})`;
  const [storeRows, adsRows] = await Promise.all([
    db
      .select({
        day: storeOrders.orderDate,
        bucket: bucketExpr,
        // The raw value, but ONLY when nothing maps it — that's exactly the set
        // the "unmapped values" banner is about. Mapped rows carry NULL, so
        // their grouping is unchanged; unmapped ones split by value, of which
        // there are only ever a handful. This replaces a separate unbounded
        // DISTINCT scan of every order the brand has ever had.
        unmappedValue: sql<
          string | null
        >`CASE WHEN ${storeSourceMappings.rawValue} IS NULL THEN NULLIF(${storeOrders.attributes} ->> ${sourceFieldKey}, '') END`,
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
      // GROUP BY ordinal (day, bucket, unmapped value) — see
      // distinctStoreSourceValues: these derived expressions carry bind params
      // drizzle would re-serialize, breaking GROUP BY matching.
      .groupBy(sql`1, 2, 3`),
    db
      .select({
        day: performanceRecords.date,
        platform: performanceRecords.platform,
        conv: sumConversions,
      })
      .from(performanceRecords)
      .where(and(...adsConds(acct, from, to, includeExcluded)))
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

  const unmapped = new Set<string>();
  for (const r of storeRows) {
    const row = ensure(r.day);
    const n = Number(r.n);
    row.storeOrders += n;
    if (r.bucket === UNATTRIBUTED) row.unattributed += n;
    else row.storeByPlatform[r.bucket] = (row.storeByPlatform[r.bucket] ?? 0) + n;
    if (r.unmappedValue) unmapped.add(r.unmappedValue);
  }
  for (const r of adsRows) {
    const row = ensure(r.day);
    row.claimedByPlatform[r.platform] =
      (row.claimedByPlatform[r.platform] ?? 0) + Number(r.conv ?? 0);
  }
  return {
    rows: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    unmappedValues: [...unmapped].sort(),
  };
}

/**
 * The per-day CHANNEL roll-up: store orders split into Website / Application /
 * Unmapped by the explicit channel mapping.
 *
 * ONE added scan — the claimed side is not re-queried here: the page already
 * has all-platform conversions per day from `reconciliationOverview`, and the
 * Channels view merges against that (`lib/db.ts` is `max: 1`, so every extra
 * query is a serial round-trip).
 *
 * The three buckets reconcile to the day's total BY CONSTRUCTION: the mapping
 * is unique per raw value, so each order lands in exactly one of them, and an
 * unmapped or blank channel lands in Unmapped rather than being folded into
 * either side.
 */
export async function reconciliationByChannel(
  from?: string,
  to?: string,
): Promise<ReconByChannelResult> {
  const acct = await getActiveAccountId();
  const channelExpr = sql<string>`${storeOrders.attributes} ->> ${STORE_CHANNEL_FIELD_KEY}`;
  // COALESCE(mapping.destination, sentinel): an unmapped value and a blank
  // cell both fall through to Unmapped.
  const bucketExpr = sql<string>`COALESCE(${storeChannelMappings.destination}, ${UNMAPPED_CHANNEL})`;

  const rows = await db
    .select({
      day: storeOrders.orderDate,
      bucket: bucketExpr,
      // The raw value, but ONLY when nothing maps it — exactly the set the
      // unmapped banner is about (same trick as the by-platform scan).
      unmappedValue: sql<
        string | null
      >`CASE WHEN ${storeChannelMappings.rawValue} IS NULL THEN NULLIF(${channelExpr}, '') END`,
      n: sql<number>`count(*)::int`,
    })
    .from(storeOrders)
    .leftJoin(
      storeChannelMappings,
      and(
        eq(storeChannelMappings.accountId, acct),
        sql`${storeChannelMappings.rawValue} = (${channelExpr})`,
      ),
    )
    .where(and(...storeConds(acct, from, to)))
    // GROUP BY ordinal — these derived expressions carry bind params drizzle
    // would re-serialize, breaking GROUP BY matching.
    .groupBy(sql`1, 2, 3`);

  const byDay = new Map<string, ReconByChannelRow>();
  const unmapped = new Set<string>();
  for (const r of rows) {
    let row = byDay.get(r.day);
    if (!row) {
      row = { day: r.day, website: 0, application: 0, unmapped: 0, storeOrders: 0 };
      byDay.set(r.day, row);
    }
    const n = Number(r.n);
    row.storeOrders += n;
    if (r.bucket === "website") row.website += n;
    else if (r.bucket === "application") row.application += n;
    else row.unmapped += n;
    if (r.unmappedValue) unmapped.add(r.unmappedValue);
  }

  return {
    rows: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    unmappedValues: [...unmapped].sort(),
  };
}

/**
 * The DISTINCT raw channel values present in uploaded orders, with frequency
 * (desc), capped — the config UI's mapping list.
 */
export async function distinctStoreChannelValues(
  cap = 200,
): Promise<Array<{ value: string; count: number }>> {
  return distinctStoreSourceValues(STORE_CHANNEL_FIELD_KEY, cap);
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
