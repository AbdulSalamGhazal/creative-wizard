import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { storeOrderItems, storeOrders, storeProductCosts, users } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { beforeVat } from "@/store/vat";

/**
 * Product costs (COGS) for the Store module — account-scoped. A product is
 * keyed as order lines are grouped: SKU, or the name when Salla sent none.
 * The cost of a line is the cost IN FORCE on its order's date: the row with
 * the latest `effective_from` on or before it.
 */

/** The product key of an order line (SQL). */
export const lineProductKey: SQL = sql`COALESCE(${storeOrderItems.sku}, ${storeOrderItems.name})`;

/**
 * The unit cost in force for a line, given the alias-free columns of
 * `store_order_items` and `store_orders` in scope. NULL = no cost entered for
 * that product on or before that day.
 */
export const lineUnitCost: SQL = sql`(
  SELECT c.unit_cost_sar FROM ${storeProductCosts} c
  WHERE c.account_id = ${storeOrderItems.accountId}
    AND c.product_key = COALESCE(${storeOrderItems.sku}, ${storeOrderItems.name})
    AND c.effective_from <= ${storeOrders.orderDate}
  ORDER BY c.effective_from DESC
  LIMIT 1
)`;

export interface StoreProductRow {
  productKey: string;
  sku: string | null;
  name: string | null;
  /** Units sold in the last 30 days (every order counts). */
  units30: number;
  /** Line totals before VAT over the last 30 days, SAR. */
  salesBeforeVat30: number;
  /** The cost in force today, or null. */
  currentCost: number | null;
  currentFrom: string | null;
}

/**
 * Every product the brand's orders have carried, most sold (30 days) first,
 * with the cost in force today. One GROUP BY over the brand's lines.
 */
export async function listStoreProducts(today: string): Promise<StoreProductRow[]> {
  const acct = await getActiveAccountId();
  const since = sql`(${today}::date - 29)`;
  const rows = await db
    .select({
      productKey: sql<string>`${lineProductKey}`,
      sku: sql<string | null>`MAX(${storeOrderItems.sku})`,
      name: sql<string | null>`MAX(${storeOrderItems.name})`,
      units30: sql<number>`COALESCE(SUM(${storeOrderItems.quantity}) FILTER (WHERE ${storeOrders.orderDate} >= ${since}), 0)::int`,
      sales30: sql<string>`COALESCE(SUM(${storeOrderItems.lineTotalSar}) FILTER (WHERE ${storeOrders.orderDate} >= ${since}), 0)`,
    })
    .from(storeOrderItems)
    .innerJoin(storeOrders, eq(storeOrders.id, storeOrderItems.storeOrderId))
    .where(and(eq(storeOrderItems.accountId, acct), sql`${lineProductKey} IS NOT NULL`))
    .groupBy(lineProductKey);

  const costs = await db
    .selectDistinctOn([storeProductCosts.productKey], {
      productKey: storeProductCosts.productKey,
      unitCost: storeProductCosts.unitCostSar,
      from: storeProductCosts.effectiveFrom,
    })
    .from(storeProductCosts)
    .where(and(eq(storeProductCosts.accountId, acct), sql`${storeProductCosts.effectiveFrom} <= ${today}`))
    .orderBy(storeProductCosts.productKey, desc(storeProductCosts.effectiveFrom));
  const costOf = new Map(costs.map((c) => [c.productKey, c]));

  return rows
    .map((r) => {
      const c = costOf.get(r.productKey);
      return {
        productKey: r.productKey,
        sku: r.sku,
        name: r.name,
        units30: r.units30,
        salesBeforeVat30: beforeVat(Number(r.sales30)),
        currentCost: c ? Number(c.unitCost) : null,
        currentFrom: c?.from ?? null,
      };
    })
    .sort((a, b) => b.units30 - a.units30 || a.productKey.localeCompare(b.productKey));
}

export interface StoreCostRow {
  id: string;
  productKey: string;
  unitCost: number;
  effectiveFrom: string;
  createdBy: string | null;
  createdAt: string;
}

/** Every cost row of the brand (each product's history), newest first per product. */
export async function listStoreProductCosts(): Promise<StoreCostRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: storeProductCosts.id,
      productKey: storeProductCosts.productKey,
      unitCost: storeProductCosts.unitCostSar,
      effectiveFrom: storeProductCosts.effectiveFrom,
      createdBy: users.name,
      createdAt: storeProductCosts.createdAt,
    })
    .from(storeProductCosts)
    .leftJoin(users, eq(users.id, storeProductCosts.createdByUserId))
    .where(eq(storeProductCosts.accountId, acct))
    .orderBy(asc(storeProductCosts.productKey), desc(storeProductCosts.effectiveFrom));
  return rows.map((r) => ({
    ...r,
    unitCost: Number(r.unitCost),
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Upsert a cost from a day (same product + day replaces its cost). */
export async function upsertStoreProductCost(row: {
  accountId: string;
  productKey: string;
  unitCost: string;
  effectiveFrom: string;
  userId: string;
}): Promise<void> {
  await db
    .insert(storeProductCosts)
    .values({
      accountId: row.accountId,
      productKey: row.productKey,
      unitCostSar: row.unitCost,
      effectiveFrom: row.effectiveFrom,
      createdByUserId: row.userId,
    })
    .onConflictDoUpdate({
      target: [storeProductCosts.accountId, storeProductCosts.productKey, storeProductCosts.effectiveFrom],
      set: { unitCostSar: row.unitCost, createdByUserId: row.userId, createdAt: new Date() },
    });
}

/** Delete one cost row of the brand. Returns what was deleted (for the audit), or null. */
export async function deleteStoreProductCost(
  accountId: string,
  id: string,
): Promise<{ productKey: string; effectiveFrom: string } | null> {
  const [gone] = await db
    .delete(storeProductCosts)
    .where(and(eq(storeProductCosts.accountId, accountId), eq(storeProductCosts.id, id)))
    .returning({ productKey: storeProductCosts.productKey, effectiveFrom: storeProductCosts.effectiveFrom });
  return gone ?? null;
}

/** Does the brand have any order line at all? (cheap probe for the empty state) */
export async function brandHasOrderLines(): Promise<boolean> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ id: storeOrderItems.id })
    .from(storeOrderItems)
    .where(eq(storeOrderItems.accountId, acct))
    .limit(1);
  return row !== undefined;
}

