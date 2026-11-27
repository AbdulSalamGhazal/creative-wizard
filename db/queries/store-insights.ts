import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  storeChannelMappings,
  storeOrderItems,
  storeOrders,
  storeSourceMappings,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { STORE_CHANNEL_FIELD_KEY, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import {
  CHANNEL_LENS,
  PLATFORM_LENS,
  SECTION_LENSES,
  SECTION_LENS_KEYS,
  type BreakdownValue,
  type LensSums,
  type LensValue,
  type ProductTotals,
  type SectionLens,
} from "@/lib/store-insights";
import { lineProductKey, lineUnitCost } from "@/db/queries/store-costs";
import { SAUDI_VAT_RATE } from "@/store/vat";
import { ORDER_STATUS_FIELD_KEY } from "@/store/order-status";
import { CONNECTOR_CUSTOMER_KEYS } from "@/lib/connector/map-order";

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
      firstOrder: sql<string | null>`MIN(${storeOrders.orderDate})::text`,
      lastOrder: sql<string | null>`MAX(${storeOrders.orderDate})::text`,
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
      firstOrder: r.firstOrder ?? null,
      lastOrder: r.lastOrder ?? null,
    })),
    totalValues: rows.length > 0 ? Number(rows[0]!.totalValues) : 0,
  };
}

// ── The decision sections (2026-11-27) ───────────────────────────────────────
//
// Every scan below runs over the SAME filtered set as the two above — the
// range, the platform and channel buckets, the same two LEFT JOINs — so a
// section's rows add up to the KPI tiles. Every order counts whatever its
// status (store.md); a status only ever adds a RATE beside the totals.

/** The filtered order set as a FROM … WHERE fragment, for the raw scans. */
function filteredOrders(
  acct: string,
  from: string,
  to: string,
  f: StoreInsightsFilters,
  extraJoin: SQL = sql``,
): SQL {
  return sql`${storeOrders}
    LEFT JOIN ${storeSourceMappings} ON ${sourceJoinOn(acct)}
    LEFT JOIN ${storeChannelMappings} ON ${channelJoinOn(acct)}
    ${extraJoin}
    WHERE ${and(...insightsConds(acct, from, to, f))}`;
}

/** A numeric attribute, or NULL when absent or not a plain number. */
function attrNum(key: string): SQL {
  const v = sql`(${storeOrders.attributes} ->> ${key})`;
  return sql`CASE WHEN ${v} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${v}::numeric END`;
}

/**
 * The Salla status by STAGE, in SQL — the same loose match as
 * `orderStatusTone` (cancelled is tested first, as there), pinned against it
 * in `tests/db/store-insights.test.ts`. A status is a flag, never a filter.
 */
const statusSlug = sql`LOWER(COALESCE(${storeOrders.attributes} ->> ${ORDER_STATUS_FIELD_KEY}, ''))`;
export const IS_CANCELLED_SQL = sql`(${statusSlug} LIKE '%cancel%' OR ${statusSlug} = 'deleted')`;
export const IS_REFUNDED_SQL = sql`(NOT ${IS_CANCELLED_SQL} AND (${statusSlug} LIKE '%refund%' OR ${statusSlug} LIKE '%restor%'))`;
const IS_LOST_SQL = sql`(${IS_CANCELLED_SQL} OR ${IS_REFUNDED_SQL})`;

/**
 * Who placed an order, for new-vs-returning: the phone (the feed writes it
 * `+<digits>`, the export's own form, so an uploaded and a fed order of one
 * person match), else Salla's customer id. Never shown anywhere — it is a
 * join key, not a value.
 */
const customerKey = sql`COALESCE(
  NULLIF(${storeOrders.attributes} ->> ${CONNECTOR_CUSTOMER_KEYS.phone}, ''),
  'id:' || NULLIF(${storeOrders.attributes} ->> 'salla_customer_id', '')
)`;

/** Days from order to delivery, when Salla sent a delivered day. */
const deliveryDays = sql`CASE
  WHEN (${storeOrders.attributes} ->> 'delivered_date') ~ '^\\d{4}-\\d{2}-\\d{2}'
  THEN LEFT(${storeOrders.attributes} ->> 'delivered_date', 10)::date - ${storeOrders.orderDate}
END`;

export interface StoreInsightsKpis {
  orders: number;
  revenue: number;
  cancelled: number;
  refunded: number;
  /** Orders whose customer had ordered before (ANY earlier order of the brand). */
  returningOrders: number;
  returningRevenue: number;
  /** A customer's first order with this brand. */
  newOrders: number;
  newRevenue: number;
  /** Orders with neither a phone nor a Salla customer id. */
  unknownCustomerOrders: number;
  /** Distinct customers in range, and those with 2+ orders in range. */
  customers: number;
  repeatCustomers: number;
  couponOrders: number;
  couponDiscount: number;
  offerOrders: number;
  offerDiscount: number;
  /** The brand's first order ever — "returning" can't see before it. */
  historyFrom: string | null;
}

/**
 * The range's headline facts in ONE scan. "Returning" ranks every order the
 * brand ever had per customer (date, then arrival) — an order is returning
 * when it is not its customer's first, so a range never mistakes a loyal
 * customer for a new one because their first order fell outside it.
 */
export async function storeInsightsKpis(
  from: string,
  to: string,
  f: StoreInsightsFilters = {},
): Promise<StoreInsightsKpis> {
  const acct = await getActiveAccountId();
  const rows = await db.execute<Record<string, string | number | null>>(sql`
    WITH seq AS MATERIALIZED (
      SELECT s.id, ROW_NUMBER() OVER (PARTITION BY s.ck ORDER BY s.order_date, s.created_at, s.id) AS n
        FROM (
          SELECT ${storeOrders.id} AS id, ${storeOrders.orderDate} AS order_date,
                 ${storeOrders.createdAt} AS created_at, ${customerKey} AS ck
            FROM ${storeOrders}
           WHERE ${storeOrders.accountId} = ${acct}
        ) s
       WHERE s.ck IS NOT NULL
    ), base AS MATERIALIZED (
      SELECT ${storeOrders.totalAmount} AS t,
             ${IS_CANCELLED_SQL} AS cancelled,
             ${IS_REFUNDED_SQL} AS refunded,
             ${customerKey} AS ck,
             seq.n,
             ${attrExpr("coupon_code")} AS coupon,
             ${attrNum("coupon_discount")} AS coupon_disc,
             ${attrExpr("offers")} AS offer,
             ${attrNum("offers_discount")} AS offer_disc
        FROM ${filteredOrders(acct, from, to, f, sql`LEFT JOIN seq ON seq.id = ${storeOrders.id}`)}
    )
    SELECT count(*)::int AS orders,
           COALESCE(SUM(t), 0) AS revenue,
           count(*) FILTER (WHERE cancelled)::int AS cancelled,
           count(*) FILTER (WHERE refunded)::int AS refunded,
           count(*) FILTER (WHERE n > 1)::int AS returning_orders,
           COALESCE(SUM(t) FILTER (WHERE n > 1), 0) AS returning_revenue,
           count(*) FILTER (WHERE n = 1)::int AS new_orders,
           COALESCE(SUM(t) FILTER (WHERE n = 1), 0) AS new_revenue,
           count(*) FILTER (WHERE ck IS NULL)::int AS unknown_orders,
           count(DISTINCT ck)::int AS customers,
           (SELECT count(*) FROM (SELECT 1 FROM base WHERE ck IS NOT NULL GROUP BY ck HAVING count(*) > 1) r)::int AS repeat_customers,
           count(*) FILTER (WHERE coupon IS NOT NULL)::int AS coupon_orders,
           COALESCE(SUM(coupon_disc), 0) AS coupon_discount,
           count(*) FILTER (WHERE offer IS NOT NULL)::int AS offer_orders,
           COALESCE(SUM(offer_disc), 0) AS offer_discount,
           (SELECT MIN(${storeOrders.orderDate})::text FROM ${storeOrders} WHERE ${storeOrders.accountId} = ${acct}) AS history_from
      FROM base
  `);
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    orders: n("orders"),
    revenue: n("revenue"),
    cancelled: n("cancelled"),
    refunded: n("refunded"),
    returningOrders: n("returning_orders"),
    returningRevenue: n("returning_revenue"),
    newOrders: n("new_orders"),
    newRevenue: n("new_revenue"),
    unknownCustomerOrders: n("unknown_orders"),
    customers: n("customers"),
    repeatCustomers: n("repeat_customers"),
    couponOrders: n("coupon_orders"),
    couponDiscount: n("coupon_discount"),
    offerOrders: n("offer_orders"),
    offerDiscount: n("offer_discount"),
    historyFrom: r.history_from == null ? null : String(r.history_from),
  };
}

/** Values one section lens may return before its tail is folded. */
export const SECTION_VALUE_CAP = 60;

export interface StoreInsightsSections {
  lenses: Record<SectionLens, LensValue[]>;
  /** The filtered range's own sums — what every section's rows add up to. */
  total: LensSums;
}

/**
 * The six decision sections in ONE scan: the filtered orders are read once
 * (a MATERIALIZED CTE) and grouped six ways, each lens capped at
 * `SECTION_VALUE_CAP` values by orders — the caller folds the tail into
 * "Other" from the range total, so a section never stops adding up.
 */
export async function storeInsightsSections(
  from: string,
  to: string,
  f: StoreInsightsFilters = {},
): Promise<StoreInsightsSections> {
  const acct = await getActiveAccountId();
  const lensCols = SECTION_LENS_KEYS.map(
    (k) => sql`${attrExpr(SECTION_LENSES[k])} AS ${sql.identifier(`l_${k}`)}`,
  );
  const measures = sql`count(*)::int AS orders,
           COALESCE(SUM(t), 0) AS revenue,
           count(*) FILTER (WHERE lost)::int AS lost,
           COALESCE(SUM(coupon_disc), 0) AS coupon_discount,
           COALESCE(SUM(offer_disc), 0) AS offer_discount,
           count(dd)::int AS delivered,
           COALESCE(SUM(dd), 0)::int AS delivery_days`;
  const perLens = SECTION_LENS_KEYS.map(
    (k) => sql`SELECT ${k}::text AS lens, ${sql.identifier(`l_${k}`)} AS value, ${measures}
                 FROM base GROUP BY 2`,
  );
  const rows = await db.execute<Record<string, string | number | null>>(sql`
    WITH base AS MATERIALIZED (
      SELECT ${storeOrders.totalAmount} AS t,
             ${IS_LOST_SQL} AS lost,
             ${attrNum("coupon_discount")} AS coupon_disc,
             ${attrNum("offers_discount")} AS offer_disc,
             ${deliveryDays} AS dd,
             ${sql.join(lensCols, sql`, `)}
        FROM ${filteredOrders(acct, from, to, f)}
    ), grouped AS (
      ${sql.join(perLens, sql` UNION ALL `)}
      UNION ALL SELECT '__total__' AS lens, NULL AS value, ${measures} FROM base
    )
    SELECT * FROM (
      SELECT grouped.*,
             ROW_NUMBER() OVER (PARTITION BY lens ORDER BY (value IS NULL) DESC, orders DESC, value) AS rn
        FROM grouped
    ) ranked
    WHERE rn <= ${SECTION_VALUE_CAP + 1}
  `);
  const toValue = (r: Record<string, string | number | null>): LensValue => ({
    value: r.value === null ? null : String(r.value),
    orders: Number(r.orders ?? 0),
    revenue: Number(r.revenue ?? 0),
    lost: Number(r.lost ?? 0),
    couponDiscount: Number(r.coupon_discount ?? 0),
    offerDiscount: Number(r.offer_discount ?? 0),
    delivered: Number(r.delivered ?? 0),
    deliveryDays: Number(r.delivery_days ?? 0),
  });
  const lenses = Object.fromEntries(SECTION_LENS_KEYS.map((k) => [k, [] as LensValue[]])) as Record<
    SectionLens,
    LensValue[]
  >;
  let total: LensSums = {
    orders: 0,
    revenue: 0,
    lost: 0,
    couponDiscount: 0,
    offerDiscount: 0,
    delivered: 0,
    deliveryDays: 0,
  };
  for (const r of rows) {
    const lens = String(r.lens);
    if (lens === "__total__") {
      const v = toValue(r);
      total = {
        orders: v.orders,
        revenue: v.revenue,
        lost: v.lost,
        couponDiscount: v.couponDiscount,
        offerDiscount: v.offerDiscount,
        delivered: v.delivered,
        deliveryDays: v.deliveryDays,
      };
    } else if (lens in lenses) {
      lenses[lens as SectionLens].push(toValue(r));
    }
  }
  return { lenses, total };
}

export interface StoreInsightsProduct {
  key: string;
  sku: string | null;
  name: string | null;
  units: number;
  orders: number;
  /** Line totals incl. VAT, SAR. */
  sales: number;
  /** Units in orders later cancelled, deleted or refunded. */
  lostUnits: number;
  costedSalesExVat: number;
  cogs: number;
  unitsWithoutCost: number;
  markdown: number;
}

export interface StoreInsightsProducts {
  rows: StoreInsightsProduct[];
  total: ProductTotals;
  /** Orders in the filtered range with no product lines (uploads). */
  ordersWithoutProducts: number;
}

/**
 * Products over the FILTERED range — the same orders as the tiles, unlike
 * `storeTopProducts` (unfiltered, for the MCP). One GROUP BY with a grand
 * total via GROUPING SETS, so the margin tile and the table come from one
 * scan. Gross profit = costed sales BEFORE VAT − the cost in force on each
 * order's date (store.md); an uncosted line is outside both, never guessed.
 */
export async function storeInsightsProducts(
  from: string,
  to: string,
  f: StoreInsightsFilters = {},
  limit = 20,
): Promise<StoreInsightsProducts> {
  const acct = await getActiveAccountId();
  const hasCost = sql`${lineUnitCost} IS NOT NULL`;
  const rows = await db.execute<Record<string, string | number | null>>(sql`
    WITH lines AS MATERIALIZED (
      SELECT ${lineProductKey} AS k,
             ${storeOrderItems.sku} AS sku,
             ${storeOrderItems.name} AS name,
             ${storeOrderItems.storeOrderId} AS oid,
             ${storeOrderItems.quantity} AS q,
             COALESCE(${storeOrderItems.lineTotalSar}, 0) AS sales,
             ${IS_LOST_SQL} AS lost,
             CASE WHEN ${hasCost} THEN COALESCE(${storeOrderItems.lineTotalSar}, 0) / ${1 + SAUDI_VAT_RATE} END AS costed_ex,
             CASE WHEN ${hasCost} THEN ${storeOrderItems.quantity} * ${lineUnitCost} END AS cogs,
             GREATEST(COALESCE(${storeOrderItems.originalUnitPriceSar} - ${storeOrderItems.unitPriceSar}, 0), 0) * ${storeOrderItems.quantity} AS markdown
        -- A comma join: the filtered set's own LEFT JOINs bind to store_orders,
        -- and the line ↔ order condition rides its WHERE.
        FROM ${storeOrderItems},
             ${filteredOrders(acct, from, to, f)}
         AND ${storeOrderItems.storeOrderId} = ${storeOrders.id}
         AND ${storeOrderItems.accountId} = ${acct}
    )
    SELECT GROUPING(k) AS is_total, k, MAX(sku) AS sku, MAX(name) AS name,
           COALESCE(SUM(q), 0)::int AS units,
           count(DISTINCT oid)::int AS orders,
           COALESCE(SUM(sales), 0) AS sales,
           COALESCE(SUM(q) FILTER (WHERE lost), 0)::int AS lost_units,
           COALESCE(SUM(costed_ex), 0) AS costed_ex,
           COALESCE(SUM(cogs), 0) AS cogs,
           COALESCE(SUM(q) FILTER (WHERE costed_ex IS NULL), 0)::int AS units_without_cost,
           COALESCE(SUM(markdown), 0) AS markdown
      FROM lines
     GROUP BY GROUPING SETS ((k), ())
     ORDER BY GROUPING(k) DESC, SUM(q) DESC NULLS LAST, k
     LIMIT ${limit + 1}
  `);
  const [bare] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM ${filteredOrders(acct, from, to, f)}
       AND NOT EXISTS (SELECT 1 FROM ${storeOrderItems} WHERE ${storeOrderItems.storeOrderId} = ${storeOrders.id})
  `);
  const num = (v: string | number | null | undefined) => Number(v ?? 0);
  let total: ProductTotals = {
    units: 0,
    sales: 0,
    costedSalesExVat: 0,
    cogs: 0,
    unitsWithoutCost: 0,
    markdown: 0,
  };
  const out: StoreInsightsProduct[] = [];
  for (const r of rows) {
    const line = {
      units: num(r.units),
      sales: num(r.sales),
      costedSalesExVat: Math.round(num(r.costed_ex) * 100) / 100,
      cogs: num(r.cogs),
      unitsWithoutCost: num(r.units_without_cost),
      markdown: num(r.markdown),
    };
    if (Number(r.is_total) === 1) {
      total = line;
    } else {
      out.push({
        key: String(r.k),
        sku: r.sku === null ? null : String(r.sku),
        name: r.name === null ? null : String(r.name),
        orders: num(r.orders),
        lostUnits: num(r.lost_units),
        ...line,
      });
    }
  }
  return { rows: out, total, ordersWithoutProducts: Number(bare?.n ?? 0) };
}
