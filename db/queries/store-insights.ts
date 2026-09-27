import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { storeChannelMappings, storeOrders, storeSourceMappings } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { STORE_CHANNEL_FIELD_KEY, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import { CHANNEL_LENS, PLATFORM_LENS, type BreakdownValue } from "@/lib/store-insights";

/**
 * Store Insights queries — an analytical read over `store_orders` ALONE.
 *
 * STORE FACTS ONLY, SAR ONLY (standing decision, 2026-09): this module must
 * never touch `performance_records`. Claimed-vs-store is Reconciliation's job
 * and money plans are Budget's; mixing them here is what turns a clean fact
 * table into a second, disagreeing reconciliation.
 *
 * TWO scans per render, both bounded by the resolved date range and both
 * account-scoped (§4.1): the per-day series, and ONE GROUP BY over the chosen
 * dimension. `lib/db.ts` is `max: 1`, so every extra query is a serial
 * round-trip — the breakdown is never fetched per value, and the page's KPIs
 * are summed from the series in JS rather than re-queried.
 *
 * The two mapping joins are LEFT JOINs on a UNIQUE `(account_id, raw_value)`,
 * so they cannot fan out a row and the bucket sums still reconcile with the
 * total by construction — the same guarantee Reconciliation relies on, using
 * the same mappings and the same sentinels.
 */

export interface StoreInsightsFilters {
  /** Platform buckets (`platformEnum` values + `UNATTRIBUTED`). */
  platforms?: readonly string[];
  /** Channel buckets (`website` | `application` | `UNMAPPED_CHANNEL`). */
  channels?: readonly string[];
}

/** `attributes ->> key`, blank normalized to NULL — the "no value" bucket. */
function attrExpr(key: string) {
  return sql<string | null>`NULLIF(${storeOrders.attributes} ->> ${key}, '')`;
}

/** The mapped platform of an order, unmapped/blank/"not an ad platform" → sentinel. */
const platformBucket = sql<string>`COALESCE(${storeSourceMappings.platform}, ${UNATTRIBUTED})`;
/** The mapped channel of an order, unmapped/blank → sentinel. */
const channelBucket = sql<string>`COALESCE(${storeChannelMappings.destination}, ${UNMAPPED_CHANNEL})`;

/**
 * Range + filter conditions, identical for BOTH scans — the trend and the
 * breakdown must describe the same set of orders or the shares lie.
 */
function insightsConds(
  acct: string,
  from: string,
  to: string,
  f: StoreInsightsFilters,
): SQL[] {
  const c: SQL[] = [
    eq(storeOrders.accountId, acct),
    gte(storeOrders.orderDate, from),
    lte(storeOrders.orderDate, to),
  ];
  if (f.platforms && f.platforms.length > 0) {
    c.push(inArray(platformBucket, [...f.platforms]));
  }
  if (f.channels && f.channels.length > 0) {
    c.push(inArray(channelBucket, [...f.channels]));
  }
  return c;
}

/**
 * Both mapping joins are applied to BOTH scans, always — the filters and the
 * two lenses each need one, joining a unique-keyed mapping table the query
 * doesn't read costs a lookup, and branching the query shape would cost a
 * second code path that can drift out of agreement with Reconciliation's
 * bucketing. These are the ON conditions; drizzle's builder types make the
 * chain itself easier to repeat than to abstract.
 */
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

export interface StoreInsightsDay {
  day: string;
  orders: number;
  revenue: number;
}

/** Per-day orders + revenue (SAR) over the range — feeds the trend AND the KPIs. */
export async function storeInsightsDaily(
  from: string,
  to: string,
  f: StoreInsightsFilters = {},
): Promise<StoreInsightsDay[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      day: storeOrders.orderDate,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
    })
    .from(storeOrders)
    .leftJoin(storeSourceMappings, sourceJoinOn(acct))
    .leftJoin(storeChannelMappings, channelJoinOn(acct))
    .where(and(...insightsConds(acct, from, to, f)))
    .groupBy(storeOrders.orderDate)
    .orderBy(storeOrders.orderDate);
  return rows.map((r) => ({
    day: r.day,
    orders: Number(r.orders),
    revenue: Number(r.revenue ?? 0),
  }));
}

/**
 * How many GROUPS one breakdown may return. A free-text custom field ("coupon
 * code", an email) can have as many distinct values as there are orders, and
 * every row crosses the wire to the client — so the tail past this cap is
 * folded into ONE remainder row by the caller (which knows the range totals),
 * keeping the sum invariant exact without an unbounded payload.
 */
export const BREAKDOWN_GROUP_CAP = 1000;

export interface StoreInsightsBreakdown {
  rows: BreakdownValue[];
  /** Distinct values in range BEFORE the cap — `> rows.length` when truncated. */
  totalValues: number;
}

/**
 * ONE GROUP BY over the chosen dimension: a field's own values (blank → the
 * NULL bucket), or one of the two MAPPED lenses. The lens buckets are
 * `COALESCE(mapping, sentinel)` over the same unique mappings Reconciliation
 * uses, so "Unattributed" and "Unmapped" mean exactly what they mean there.
 */
export async function storeInsightsBreakdown(
  dimension: string,
  from: string,
  to: string,
  f: StoreInsightsFilters = {},
): Promise<StoreInsightsBreakdown> {
  const acct = await getActiveAccountId();
  const bucket =
    dimension === PLATFORM_LENS
      ? platformBucket
      : dimension === CHANNEL_LENS
        ? channelBucket
        : attrExpr(dimension);

  const rows = await db
    .select({
      value: bucket,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
      // Groups before the LIMIT — window functions run after grouping, so this
      // is the honest distinct-value count and costs no second scan.
      totalValues: sql<number>`count(*) OVER ()::int`,
    })
    .from(storeOrders)
    .leftJoin(storeSourceMappings, sourceJoinOn(acct))
    .leftJoin(storeChannelMappings, channelJoinOn(acct))
    .where(and(...insightsConds(acct, from, to, f)))
    // GROUP BY ordinal: the bucket expressions carry bind params drizzle would
    // re-serialize, which breaks GROUP BY matching (same note as the
    // reconciliation scans).
    .groupBy(sql`1`)
    .orderBy(sql`2 DESC`)
    .limit(BREAKDOWN_GROUP_CAP);

  return {
    rows: rows.map((r) => ({
      value: r.value === null ? null : String(r.value),
      orders: Number(r.orders),
      revenue: Number(r.revenue ?? 0),
    })),
    totalValues: rows.length > 0 ? Number(rows[0]!.totalValues) : 0,
  };
}
