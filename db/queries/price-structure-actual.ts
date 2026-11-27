import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creatives,
  performanceRecords,
  products,
  psAdProductMappings,
  psSkuMappings,
  psSkuOfferMappings,
  storeOrderItems,
  storeOrders,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { lineProductKey, lineUnitCost } from "@/db/queries/store-costs";
import { attrNum, IS_LOST_SQL } from "@/db/queries/store-insights";
import { ORDER_STATUS_FIELD_KEY } from "@/store/order-status";
import { SAUDI_VAT_RATE } from "@/store/vat";
import type {
  ActualFacts,
  ActualMappings,
  AdSpendFact,
  DeliveryRateFact,
  LineFact,
  OrderFact,
  Outcome,
} from "@/price-structure/actual/facts";
import { skuOfferKey } from "@/price-structure/actual/facts";

/**
 * Pricing · Actual — the query layer (2026-11-27). Reads the STORE (orders,
 * their lines, Product costs) and the ADS uploads (spend by the creative's
 * product) for a range, plus the brand's SKU / ad-product mappings. Every
 * read is account-scoped. Three scans and three small mapping reads per
 * render; `lib/db.ts` is `max: 1`, so they run one after another.
 *
 * The money split is Salla's own identity (verified on a real order
 * 2026-11-27): total = sub_total − discount + shipping + COD fee + tax.
 * So per order: net = total − VAT · product = sub_total − discount ·
 * fees = net − product, and the product part is spread over the lines by
 * their line totals. An order Salla sent without its VAT (an upload) is
 * taken as 15% inclusive; one without a sub_total has fees = shipping + COD.
 */

/** The payment method attribute (feed-owned). Blank = "not reported". */
export const NOT_REPORTED = "not reported";
const PAYMENT_KEY = "payment_method";

/** A line Salla sent with neither SKU nor name — kept, so the lines still foot to the orders. */
export const UNNAMED = "(no SKU or name)";

/** How many days of closed orders give a payment method its delivery rate. */
export const RATE_WINDOW_DAYS = 90;

const statusSlug = sql`LOWER(COALESCE(${storeOrders.attributes} ->> ${ORDER_STATUS_FIELD_KEY}, ''))`;
/**
 * delivered · lost (cancelled, deleted, refunded — the Store's own
 * `IS_LOST_SQL`) · uploaded (no status and the feed never wrote it) · open.
 */
const OUTCOME_SQL: SQL = sql`CASE WHEN ${IS_LOST_SQL} THEN 'lost'
  WHEN ${statusSlug} = 'delivered' THEN 'delivered'
  WHEN ${statusSlug} = '' AND ${storeOrders.connectorUpdatedAt} IS NULL THEN 'uploaded'
  ELSE 'open' END`;
const PAYMENT_SQL: SQL = sql`COALESCE(NULLIF(${storeOrders.attributes} ->> ${PAYMENT_KEY}, ''), ${NOT_REPORTED})`;

const num = (v: unknown) => Number(v ?? 0);

/** The per-order money, one row per order of the brand in the range (a MATERIALIZED CTE body). */
function ordersCte(acct: string, from: string, to: string): SQL {
  const vatAttr = attrNum("vat");
  const total = sql`${storeOrders.totalAmount}::numeric`;
  const vat = sql`COALESCE(${vatAttr}, ${total} - ${total} / ${1 + SAUDI_VAT_RATE})`;
  return sql`
    SELECT ${storeOrders.id} AS id,
           ${OUTCOME_SQL} AS outcome,
           ${PAYMENT_SQL} AS pm,
           ${total} AS total,
           ${vat} AS vat,
           ${total} - ${vat} AS net,
           ${attrNum("subtotal")} AS subtotal,
           COALESCE(${attrNum("discount")}, 0) AS discount,
           COALESCE(${attrNum("shipping_fee")}, 0) + COALESCE(${attrNum("cod_fee")}, 0) AS fees,
           (SELECT SUM(COALESCE(${storeOrderItems.lineTotalSar}, 0)) FROM ${storeOrderItems}
             WHERE ${storeOrderItems.storeOrderId} = ${storeOrders.id}) AS lines_total,
           (SELECT SUM(${storeOrderItems.quantity}) FROM ${storeOrderItems}
             WHERE ${storeOrderItems.storeOrderId} = ${storeOrders.id}) AS lines_qty
      FROM ${storeOrders}
     WHERE ${storeOrders.accountId} = ${acct}
       AND ${storeOrders.orderDate} >= ${from}
       AND ${storeOrders.orderDate} <= ${to}`;
}

/**
 * The product part of an order's net (`o` = the orders CTE): sub_total −
 * discount when Salla sent a sub_total, else net − (shipping + COD). NULL on
 * an order without lines — its whole net is "orders without products".
 */
const PRODUCT_NET = sql`CASE WHEN o.lines_qty IS NULL THEN NULL
  WHEN o.subtotal IS NOT NULL THEN o.subtotal - o.discount
  ELSE o.net - o.fees END`;

export async function actualFacts(from: string, to: string, ratesFrom: string): Promise<ActualFacts> {
  const acct = await getActiveAccountId();

  // 1 · Lines: product net spread by line totals (by quantity when every
  //     line total is zero/missing), the cost in force on the order's day.
  const lineRows = await db.execute<Record<string, string | number | null>>(sql`
    WITH o AS MATERIALIZED (${ordersCte(acct, from, to)})
    SELECT COALESCE(${lineProductKey}, ${UNNAMED}) AS k,
           MAX(${storeOrderItems.name}) AS name,
           ${storeOrderItems.quantity} AS q,
           o.outcome, o.pm,
           count(*)::int AS lines,
           COALESCE(SUM(${storeOrderItems.quantity}), 0)::int AS units,
           COALESCE(SUM((${PRODUCT_NET}) * CASE WHEN o.lines_total > 0
                 THEN COALESCE(${storeOrderItems.lineTotalSar}, 0) / o.lines_total
                 ELSE ${storeOrderItems.quantity}::numeric / NULLIF(o.lines_qty, 0) END), 0) AS revenue,
           COALESCE(SUM(${storeOrderItems.quantity} * ${lineUnitCost}), 0) AS cogs,
           COALESCE(SUM(${storeOrderItems.quantity}) FILTER (WHERE ${lineUnitCost} IS NULL), 0)::int AS uncosted
      FROM ${storeOrderItems}
      JOIN o ON o.id = ${storeOrderItems.storeOrderId}
      JOIN ${storeOrders} ON ${storeOrders.id} = ${storeOrderItems.storeOrderId}
     WHERE ${storeOrderItems.accountId} = ${acct}
     GROUP BY 1, ${storeOrderItems.quantity}, o.outcome, o.pm
  `);

  // 2 · Orders: totals, VAT, net and its product / fees split.
  const orderRows = await db.execute<Record<string, string | number | null>>(sql`
    WITH o AS MATERIALIZED (${ordersCte(acct, from, to)})
    SELECT o.outcome, o.pm,
           count(*)::int AS orders,
           COALESCE(SUM(o.total), 0) AS total,
           COALESCE(SUM(o.vat), 0) AS vat,
           COALESCE(SUM(o.net), 0) AS net,
           COALESCE(SUM(${PRODUCT_NET}), 0) AS product_net,
           COALESCE(SUM(o.net - (${PRODUCT_NET})), 0) AS fees_net,
           count(*) FILTER (WHERE o.lines_qty IS NULL)::int AS without_lines,
           COALESCE(SUM(o.net) FILTER (WHERE o.lines_qty IS NULL), 0) AS net_without_lines
      FROM o
     GROUP BY o.outcome, o.pm
  `);

  // 3 · Delivery rates: CLOSED orders (delivered or lost) of the trailing
  //     window that ends with the range, per payment method.
  const rateRows = await db.execute<Record<string, string | number | null>>(sql`
    SELECT ${PAYMENT_SQL} AS pm,
           count(*) FILTER (WHERE ${OUTCOME_SQL} = 'delivered')::int AS delivered,
           count(*) FILTER (WHERE ${OUTCOME_SQL} = 'lost')::int AS lost
      FROM ${storeOrders}
     WHERE ${storeOrders.accountId} = ${acct}
       AND ${storeOrders.orderDate} >= ${ratesFrom}
       AND ${storeOrders.orderDate} <= ${to}
       AND ${storeOrders.connectorUpdatedAt} IS NOT NULL
     GROUP BY 1
  `);

  const adSpend = await actualAdSpend(acct, from, to);

  const lines: LineFact[] = lineRows.map((r) => ({
    productKey: String(r.k),
    name: r.name === null ? null : String(r.name),
    quantity: num(r.q),
    outcome: String(r.outcome) as Outcome,
    paymentMethod: String(r.pm),
    lines: num(r.lines),
    units: num(r.units),
    revenue: num(r.revenue),
    cogs: num(r.cogs),
    uncostedUnits: num(r.uncosted),
  }));
  const orders: OrderFact[] = orderRows.map((r) => {
    const netWithoutLines = num(r.net_without_lines);
    return {
      outcome: String(r.outcome) as Outcome,
      paymentMethod: String(r.pm),
      orders: num(r.orders),
      totalInclVat: num(r.total),
      vat: num(r.vat),
      net: num(r.net),
      productNet: num(r.product_net),
      feesNet: num(r.fees_net),
      ordersWithoutLines: num(r.without_lines),
      netWithoutLines,
    };
  });
  const rates: DeliveryRateFact[] = rateRows.map((r) => ({
    paymentMethod: String(r.pm),
    delivered: num(r.delivered),
    lost: num(r.lost),
  }));
  return { from, to, lines, orders, rates, ratesFrom, ratesTo: to, adSpend };
}

/**
 * Ad spend (USD) per Library product over the range — RAW like every Budget
 * actual (no exclusion filter: money spent is spent), every platform. The
 * product is the creative's (`creatives.product_id` is NOT NULL), the same
 * join as `budgetProductSeries`.
 */
async function actualAdSpend(acct: string, from: string, to: string): Promise<AdSpendFact[]> {
  const rows = await db
    .select({
      productId: creatives.productId,
      productName: products.name,
      spend: sql<string>`COALESCE(SUM(${performanceRecords.spend}), 0)`,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        gte(performanceRecords.date, from),
        lte(performanceRecords.date, to),
      ),
    )
    .groupBy(creatives.productId, products.name);
  return rows.map((r) => ({ productId: r.productId, productName: r.productName, spendUsd: Number(r.spend) }));
}

/** The brand's mappings, in the engine's shape. */
export async function actualMappings(): Promise<ActualMappings> {
  const acct = await getActiveAccountId();
  const [sku, offer, ad] = [
    await db
      .select({ k: psSkuMappings.productKey, p: psSkuMappings.psProductId })
      .from(psSkuMappings)
      .where(eq(psSkuMappings.accountId, acct)),
    await db
      .select({ k: psSkuOfferMappings.productKey, q: psSkuOfferMappings.quantity, o: psSkuOfferMappings.psOfferId })
      .from(psSkuOfferMappings)
      .where(eq(psSkuOfferMappings.accountId, acct)),
    await db
      .select({ id: psAdProductMappings.productId, p: psAdProductMappings.psProductId })
      .from(psAdProductMappings)
      .where(eq(psAdProductMappings.accountId, acct)),
  ];
  return {
    skuProduct: Object.fromEntries(sku.map((r) => [r.k, r.p])),
    skuOffer: Object.fromEntries(offer.map((r) => [skuOfferKey(r.k, r.q), r.o])),
    adProduct: Object.fromEntries(ad.map((r) => [r.id, r.p])),
  };
}

export interface MappingSku {
  productKey: string;
  sku: string | null;
  name: string | null;
  /** Units sold in the window. */
  units: number;
  /** The line quantities seen in the window, ascending. */
  quantities: number[];
}

/**
 * Every SKU the brand's order lines carried over the window, most sold first,
 * with the quantities its lines came in — what the mapping screen lists.
 */
export async function mappingSkus(from: string, to: string): Promise<MappingSku[]> {
  const acct = await getActiveAccountId();
  const rows = await db.execute<Record<string, string | number | number[] | null>>(sql`
    SELECT ${lineProductKey} AS k, MAX(${storeOrderItems.sku}) AS sku, MAX(${storeOrderItems.name}) AS name,
           COALESCE(SUM(${storeOrderItems.quantity}), 0)::int AS units,
           array_agg(DISTINCT ${storeOrderItems.quantity} ORDER BY ${storeOrderItems.quantity}) AS qs
      FROM ${storeOrderItems}
      JOIN ${storeOrders} ON ${storeOrders.id} = ${storeOrderItems.storeOrderId}
     WHERE ${storeOrderItems.accountId} = ${acct}
       AND ${storeOrders.orderDate} >= ${from}
       AND ${storeOrders.orderDate} <= ${to}
       AND ${lineProductKey} IS NOT NULL
     GROUP BY 1
     ORDER BY units DESC, k
  `);
  return rows.map((r) => ({
    productKey: String(r.k),
    sku: r.sku === null ? null : String(r.sku),
    name: r.name === null ? null : String(r.name),
    units: num(r.units),
    quantities: (Array.isArray(r.qs) ? r.qs : []).map(Number),
  }));
}

/** The brand's Library products (active and archived) for the ad-product mapping. */
export async function mappingAdProducts(): Promise<Array<{ id: string; name: string; status: string }>> {
  const acct = await getActiveAccountId();
  return db
    .select({ id: products.id, name: products.name, status: products.status })
    .from(products)
    .where(eq(products.accountId, acct))
    .orderBy(asc(products.name));
}

// ── Writes (the server action checks `price_structure.edit` first) ──────────

type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Map a SKU to a Pricing product (null clears it and its offers). */
export async function setSkuProduct(
  exec: Exec,
  acct: string,
  userId: string,
  productKey: string,
  psProductId: string | null,
): Promise<void> {
  if (psProductId === null) {
    await exec.delete(psSkuMappings).where(and(eq(psSkuMappings.accountId, acct), eq(psSkuMappings.productKey, productKey)));
    await exec
      .delete(psSkuOfferMappings)
      .where(and(eq(psSkuOfferMappings.accountId, acct), eq(psSkuOfferMappings.productKey, productKey)));
    return;
  }
  const prev = await exec
    .select({ p: psSkuMappings.psProductId })
    .from(psSkuMappings)
    .where(and(eq(psSkuMappings.accountId, acct), eq(psSkuMappings.productKey, productKey)));
  await exec
    .insert(psSkuMappings)
    .values({ accountId: acct, productKey, psProductId, updatedBy: userId })
    .onConflictDoUpdate({
      target: [psSkuMappings.accountId, psSkuMappings.productKey],
      set: { psProductId, updatedBy: userId, updatedAt: sql`now()` },
    });
  // A new product makes the old offers meaningless — they belonged to the old one.
  if (prev[0] && prev[0].p !== psProductId) {
    await exec
      .delete(psSkuOfferMappings)
      .where(and(eq(psSkuOfferMappings.accountId, acct), eq(psSkuOfferMappings.productKey, productKey)));
  }
}

/** Map a SKU at a quantity to an offer (null clears it). */
export async function setSkuOffer(
  exec: Exec,
  acct: string,
  userId: string,
  productKey: string,
  quantity: number,
  psOfferId: string | null,
): Promise<void> {
  const where = and(
    eq(psSkuOfferMappings.accountId, acct),
    eq(psSkuOfferMappings.productKey, productKey),
    eq(psSkuOfferMappings.quantity, quantity),
  );
  if (psOfferId === null) {
    await exec.delete(psSkuOfferMappings).where(where);
    return;
  }
  await exec
    .insert(psSkuOfferMappings)
    .values({ accountId: acct, productKey, quantity, psOfferId, updatedBy: userId })
    .onConflictDoUpdate({
      target: [psSkuOfferMappings.accountId, psSkuOfferMappings.productKey, psSkuOfferMappings.quantity],
      set: { psOfferId, updatedBy: userId, updatedAt: sql`now()` },
    });
}

/** Map a Library product's ad spend to a Pricing product (null clears it). */
export async function setAdProduct(
  exec: Exec,
  acct: string,
  userId: string,
  productId: string,
  psProductId: string | null,
): Promise<void> {
  const where = and(eq(psAdProductMappings.accountId, acct), eq(psAdProductMappings.productId, productId));
  if (psProductId === null) {
    await exec.delete(psAdProductMappings).where(where);
    return;
  }
  await exec
    .insert(psAdProductMappings)
    .values({ accountId: acct, productId, psProductId, updatedBy: userId })
    .onConflictDoUpdate({
      target: [psAdProductMappings.accountId, psAdProductMappings.productId],
      set: { psProductId, updatedBy: userId, updatedAt: sql`now()` },
    });
}

/** The Library product's name when it is the active brand's, else null (tenancy rule 4: re-validate a caller's FK). */
export async function libraryProductInAccount(exec: Exec, acct: string, productId: string): Promise<string | null> {
  const [row] = await exec
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.accountId, acct), eq(products.id, productId)));
  return row?.name ?? null;
}

/** Ad spend (USD) per Library product over a window — the mapping screen's ordering and figure. */
export async function mappingAdSpend(from: string, to: string): Promise<AdSpendFact[]> {
  return actualAdSpend(await getActiveAccountId(), from, to);
}
