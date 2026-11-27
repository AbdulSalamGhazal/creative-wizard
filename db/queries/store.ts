import { and, asc, between, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  storeChannelMappings,
  storeOrderItems,
  storeOrders,
  storeOrderFields,
  storeSourceMappings,
  storeUploadBatches,
  users,
} from "@/db/schema";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { STORE_CHANNEL_FIELD_KEY, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import { ORDER_STAGES, ORDER_STATUS_FIELD_KEY, type OrderStage } from "@/store/order-status";
import { getActiveAccountId } from "@/lib/tenant";
import { beforeVat } from "@/store/vat";
import { isCoreKey, isSystemRequiredKey, type StoreField, type StoreFieldType } from "@/store/fields";
import { CleanupScopeChangedError } from "@/lib/cleanup-guard";
import { lineUnitCost } from "@/db/queries/store-costs";
import { CONNECTOR_OWNED_KEYS } from "@/lib/connector/map-order";

/** Attribute keys an upload may not change on an order the Salla feed holds. */
const FEED_OWNED: ReadonlySet<string> = new Set(CONNECTOR_OWNED_KEYS);

/**
 * Store module queries — account-scoped (tenant §4.1) reads for the Store page
 * and its config. Currency is SAR; amounts are returned as JS numbers (the
 * `numeric(12,2)` column arrives as a string and is `Number()`-ed here).
 */

// ── Field config ─────────────────────────────────────────────────────────────

/** All order fields for the active account (core + custom), sorted for display. */
export async function listStoreFields(): Promise<StoreField[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: storeOrderFields.id,
      key: storeOrderFields.key,
      label: storeOrderFields.label,
      type: storeOrderFields.type,
      required: storeOrderFields.required,
      headers: storeOrderFields.headers,
      sortOrder: storeOrderFields.sortOrder,
    })
    .from(storeOrderFields)
    .where(eq(storeOrderFields.accountId, acct))
    .orderBy(asc(storeOrderFields.sortOrder), asc(storeOrderFields.label));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type as StoreFieldType,
    required: r.required,
    headers: r.headers ?? [],
    sortOrder: r.sortOrder,
    core: isCoreKey(r.key),
    systemRequired: isSystemRequiredKey(r.key),
  }));
}

// ── Orders (paginated) ───────────────────────────────────────────────────────

export interface StoreOrderRow {
  id: string;
  orderId: string;
  orderDate: string;
  totalAmount: number;
  attributes: Record<string, unknown>;
  /** The Salla feed holds this order (false = it came from an upload only). */
  fromFeed: boolean;
  /** The connector's own updated_at for the newest version it delivered (ISO; null = never synced). */
  connectorUpdatedAt: string | null;
  /** When the row was first written / last written here (ISO timestamps). */
  createdAt: string;
  updatedAt: string;
  /** The file that first wrote the order (null = the Salla feed wrote it). */
  uploadFileName: string | null;
}

/**
 * The orders table's columns — one SELECT for the page and the export. The
 * upload's file name is a PK join off `upload_batch_id` (already on the row).
 */
const ORDER_ROW_SELECT = {
  id: storeOrders.id,
  orderId: storeOrders.orderId,
  orderDate: storeOrders.orderDate,
  totalAmount: storeOrders.totalAmount,
  attributes: storeOrders.attributes,
  connectorUpdatedAt: storeOrders.connectorUpdatedAt,
  createdAt: storeOrders.createdAt,
  updatedAt: storeOrders.updatedAt,
  uploadFileName: storeUploadBatches.fileName,
};

function toOrderRow(r: {
  id: string;
  orderId: string;
  orderDate: string;
  totalAmount: string;
  attributes: unknown;
  connectorUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  uploadFileName: string | null;
}): StoreOrderRow {
  return {
    id: r.id,
    orderId: r.orderId,
    orderDate: r.orderDate,
    totalAmount: Number(r.totalAmount),
    attributes: (r.attributes ?? {}) as Record<string, unknown>,
    fromFeed: r.connectorUpdatedAt !== null,
    connectorUpdatedAt: r.connectorUpdatedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    uploadFileName: r.uploadFileName,
  };
}

export interface StoreOrdersFilters {
  from?: string;
  to?: string;
  q?: string;
  page: number;
  /** Core sort key only ('order_id' | 'order_date' | 'total_amount'); custom cols sort client-side. */
  sort: "order_id" | "order_date" | "total_amount";
  dir: "asc" | "desc";
  /** The status tab; absent = All. */
  stage?: OrderStage;
  /** Filters (2026-11-27) — each list ORs within itself, the lists AND. */
  payments?: readonly string[];
  paymentTypes?: readonly string[];
  platforms?: readonly string[];
  channels?: readonly string[];
  skus?: readonly string[];
  coupons?: readonly string[];
  offers?: readonly string[];
  /** The shipping country, as Salla sends it. */
  countries?: readonly string[];
}

/** One product line of an order, as the Salla feed last delivered it. */
export interface StoreOrderItem {
  sku: string | null;
  name: string | null;
  quantity: number;
  /** The line incl. VAT, SAR; null when a foreign-currency order had no rate. */
  lineTotal: number | null;
  /** The unit cost in force on the order's date (SAR), or null when none is entered. */
  unitCost: number | null;
  /** Per unit, excl. VAT, SAR: what it sold at and its regular price; null when not sent. */
  unitPrice: number | null;
  originalUnitPrice: number | null;
}

export interface StoreOrdersResult {
  rows: StoreOrderRow[];
  /** The page's product lines keyed by `StoreOrderRow.id`; an order with none is absent. */
  itemsByOrder: Record<string, StoreOrderItem[]>;
  /** Total matching the filter (for the pager). */
  total: number;
  /** SUM(total_amount) over the WHOLE filtered set, in SAR (for the footer). */
  sumTotal: number;
  page: number;
  pageSize: number;
}

export const STORE_PAGE_SIZE = 100;

/**
 * CONTRACT: `f.from`/`f.to` are a RESOLVED range, never the raw optional search
 * params. Each side binds only when present, so a paramless request listed
 * EVERY order ever while the picker announced "Last 7 days" — display and query
 * have to come from one server-side resolution (see `/store/orders/page.tsx`).
 * Absence therefore means the user explicitly chose an unbounded range.
 */
function orderConds(
  acct: string,
  f: Omit<StoreOrdersFilters, "page" | "sort" | "dir">,
  opts: { withStage?: boolean } = {},
): SQL[] {
  const c: SQL[] = [eq(storeOrders.accountId, acct)];
  if (f.from) c.push(gte(storeOrders.orderDate, f.from));
  if (f.to) c.push(lte(storeOrders.orderDate, f.to));
  const search = orderSearchCond(f.q);
  if (search) c.push(search);
  if ((opts.withStage ?? true) && f.stage) c.push(sql`${orderStageSql} = ${f.stage}`);
  const inAttr = (key: string, values: readonly string[] | undefined) => {
    if (values && values.length > 0) c.push(inArray(attr(key), [...values]));
  };
  inAttr("payment_method", f.payments);
  inAttr("payment_type", f.paymentTypes);
  inAttr("coupon_code", f.coupons);
  inAttr("country", f.countries);
  if (f.offers && f.offers.length > 0) {
    // Several offers on one order arrive joined with ", " — match any of them.
    c.push(
      sql`string_to_array(${attr("offers")}, ', ') && ARRAY[${sql.join(
        f.offers.map((o) => sql`${o}`),
        sql`, `,
      )}]::text[]`,
    );
  }
  if (f.platforms && f.platforms.length > 0) {
    c.push(inArray(platformBucketSql(acct), [...f.platforms]));
  }
  if (f.channels && f.channels.length > 0) {
    c.push(inArray(channelBucketSql(acct), [...f.channels]));
  }
  if (f.skus && f.skus.length > 0) {
    c.push(sql`EXISTS (
      SELECT 1 FROM ${storeOrderItems}
       WHERE ${storeOrderItems.storeOrderId} = ${storeOrders.id}
         AND COALESCE(${storeOrderItems.sku}, ${storeOrderItems.name}) IN (${sql.join(
           f.skus.map((p) => sql`${p}`),
           sql`, `,
         )})
    )`);
  }
  return c;
}

/** `attributes ->> key` (text), as the filters compare it. */
function attr(key: string) {
  return sql<string>`(${storeOrders.attributes} ->> ${key})`;
}

/**
 * An order's platform bucket, EXACTLY as Insights and Reconciliation bucket it
 * — the unique `(account_id, raw_value)` source mapping, unmapped → the
 * Unattributed sentinel — as a scalar subquery, so the listing's own joins
 * stay as they are.
 */
function platformBucketSql(acct: string) {
  return sql<string>`COALESCE((
    SELECT ${storeSourceMappings.platform} FROM ${storeSourceMappings}
     WHERE ${storeSourceMappings.accountId} = ${acct}
       AND ${storeSourceMappings.rawValue} = ${attr(STORE_SOURCE_FIELD_KEY)}
  ), ${UNATTRIBUTED})`;
}

function channelBucketSql(acct: string) {
  return sql<string>`COALESCE((
    SELECT ${storeChannelMappings.destination} FROM ${storeChannelMappings}
     WHERE ${storeChannelMappings.accountId} = ${acct}
       AND ${storeChannelMappings.rawValue} = ${attr(STORE_CHANNEL_FIELD_KEY)}
  ), ${UNMAPPED_CHANNEL})`;
}

/**
 * The SQL twin of `orderStatusStage` (store/order-status.ts) — the same loose
 * match in the same order; `tests/db/store-orders-filters.test.ts` pins every
 * known slug to it.
 */
const stageSlug = sql`LOWER(TRIM(COALESCE(${storeOrders.attributes} ->> ${ORDER_STATUS_FIELD_KEY}, '')))`;
export const orderStageSql = sql<OrderStage>`(CASE
  WHEN ${stageSlug} = '' THEN 'none'
  WHEN ${stageSlug} LIKE '%cancel%' OR ${stageSlug} = 'deleted' THEN 'cancelled'
  WHEN ${stageSlug} LIKE '%refund%' OR ${stageSlug} LIKE '%restor%' THEN 'refunded'
  WHEN ${stageSlug} = 'delivered' THEN 'delivered'
  WHEN ${stageSlug} = 'shipped' OR ${stageSlug} LIKE '%delivering%' THEN 'on_the_way'
  WHEN ${stageSlug} = 'payment_pending' THEN 'awaiting'
  ELSE 'in_progress'
END)`;

/** LIKE wildcards in a typed search are literal characters, not patterns. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * The search box (user decision 2026-11-27: "order + customer"): order ID,
 * customer name, phone, email, coupon code and tracking number, any of them,
 * case-insensitive substring. A leading "#" is dropped (Salla shows order
 * numbers with one). A query with 5+ digits also matches the phone by its
 * digits alone, with a leading 00966 / 966 / 0 stripped — so "0501234567"
 * finds "+966501234567".
 */
export function orderSearchCond(q: string | undefined): SQL | null {
  const raw = q?.trim().replace(/^#/, "") ?? "";
  if (!raw) return null;
  const pat = `%${likeEscape(raw)}%`;
  const parts: SQL[] = [
    ilike(storeOrders.orderId, pat),
    ...["customer_name", "email", "phone", "coupon_code", "tracking_number"].map(
      (k) => sql`${attr(k)} ILIKE ${pat}`,
    ),
  ];
  const digits = raw.replace(/\D/g, "").replace(/^(00966|966|0)/, "");
  if (digits.length >= 5 && /^[\d\s+()-]+$/.test(raw)) {
    parts.push(
      sql`regexp_replace(COALESCE(${attr("phone")}, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`,
    );
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Does the active brand have ANY order? (R-059) An empty Orders table is
 * "No orders yet" + the upload only when the answer is no; otherwise the
 * range or search hid them. One probe on an `account_id`-leading index.
 */
export async function brandHasStoreOrders(): Promise<boolean> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ id: storeOrders.id })
    .from(storeOrders)
    .where(eq(storeOrders.accountId, acct))
    .limit(1);
  return row !== undefined;
}

export async function listStoreOrders(
  f: StoreOrdersFilters,
): Promise<StoreOrdersResult> {
  const acct = await getActiveAccountId();
  const conds = orderConds(acct, f);
  const page = Math.max(1, f.page);

  const sortCol =
    f.sort === "order_id"
      ? storeOrders.orderId
      : f.sort === "total_amount"
        ? storeOrders.totalAmount
        : storeOrders.orderDate;
  const orderBy = f.dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [rows, [agg]] = await Promise.all([
    db
      .select(ORDER_ROW_SELECT)
      .from(storeOrders)
      .leftJoin(storeUploadBatches, eq(storeUploadBatches.id, storeOrders.uploadBatchId))
      .where(and(...conds))
      // Secondary key by id so paging is stable when the sort col ties.
      .orderBy(orderBy, asc(storeOrders.id))
      .limit(STORE_PAGE_SIZE)
      .offset((page - 1) * STORE_PAGE_SIZE),
    db
      .select({
        n: sql<number>`COUNT(*)::int`,
        sum: sql<string | null>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
      })
      .from(storeOrders)
      .where(and(...conds)),
  ]);

  return {
    rows: rows.map(toOrderRow),
    itemsByOrder: await orderItemsFor(
      acct,
      rows.map((r) => r.id),
    ),
    total: agg?.n ?? 0,
    sumTotal: Number(agg?.sum ?? 0),
    page,
    pageSize: STORE_PAGE_SIZE,
  };
}

/**
 * Orders per status tab over the SAME range, search and filters as the table
 * — everything but the tab itself, so each count is what clicking it shows
 * and "All" is the sum. One GROUP BY.
 */
export async function storeOrderStageCounts(
  f: Omit<StoreOrdersFilters, "page" | "sort" | "dir">,
): Promise<Record<OrderStage, number>> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({ stage: orderStageSql, n: sql<number>`count(*)::int` })
    .from(storeOrders)
    .where(and(...orderConds(acct, f, { withStage: false })))
    .groupBy(sql`1`);
  const out = Object.fromEntries(ORDER_STAGES.map((s) => [s, 0])) as Record<OrderStage, number>;
  for (const r of rows) {
    if ((ORDER_STAGES as readonly string[]).includes(r.stage)) out[r.stage] = Number(r.n);
  }
  return out;
}

/** How many values each Filters list offers — the most-used first. */
export const ORDER_FILTER_OPTION_CAP = 200;

export interface StoreOrderFilterOptions {
  payments: string[];
  paymentTypes: string[];
  coupons: string[];
  offers: string[];
  countries: string[];
  products: Array<{ key: string; name: string | null }>;
}

/**
 * The values the Filters dialog offers, from the brand's own orders (all
 * time, so a list doesn't change under you with the range), most-used first
 * and capped. Values are read, never typed: a value that holds a comma can't
 * ride the comma-separated URL, so it isn't offered. Two scans: the order
 * attributes in one UNION, the products in one GROUP BY.
 */
export async function storeOrderFilterOptions(): Promise<StoreOrderFilterOptions> {
  const acct = await getActiveAccountId();
  const lens = (name: string, value: SQL) => sql`
    SELECT ${name}::text AS lens, v AS value, count(*) AS n
      FROM (SELECT ${value} AS v FROM ${storeOrders} WHERE ${storeOrders.accountId} = ${acct}) x
     WHERE v IS NOT NULL AND v <> '' AND strpos(v, ',') = 0
     GROUP BY v`;
  const [attrRows, productRows] = await Promise.all([
    db.execute<{ lens: string; value: string; n: number }>(sql`
      SELECT lens, value FROM (
        SELECT lens, value, ROW_NUMBER() OVER (PARTITION BY lens ORDER BY n DESC, value) AS rn
          FROM (
            ${lens("payments", attr("payment_method"))}
            UNION ALL ${lens("paymentTypes", attr("payment_type"))}
            UNION ALL ${lens("coupons", attr("coupon_code"))}
            UNION ALL ${lens("countries", attr("country"))}
            UNION ALL ${lens(
              "offers",
              sql`unnest(string_to_array(${attr("offers")}, ', '))`,
            )}
          ) g
      ) r
      WHERE rn <= ${ORDER_FILTER_OPTION_CAP}
    `),
    db
      .select({
        key: sql<string>`COALESCE(${storeOrderItems.sku}, ${storeOrderItems.name})`,
        name: sql<string | null>`MAX(${storeOrderItems.name})`,
      })
      .from(storeOrderItems)
      .where(eq(storeOrderItems.accountId, acct))
      .groupBy(sql`1`)
      .orderBy(sql`SUM(${storeOrderItems.quantity}) DESC`, sql`1`)
      .limit(ORDER_FILTER_OPTION_CAP),
  ]);
  const out: StoreOrderFilterOptions = {
    payments: [],
    paymentTypes: [],
    coupons: [],
    offers: [],
    countries: [],
    products: productRows
      .filter((p) => p.key !== null && !p.key.includes(","))
      .map((p) => ({ key: p.key, name: p.name })),
  };
  for (const r of attrRows) {
    const list = out[r.lens as Exclude<keyof StoreOrderFilterOptions, "products">];
    if (list) list.push(String(r.value));
  }
  return out;
}

/** The product lines of the given orders (one page), account-scoped. */
async function orderItemsFor(
  acct: string,
  storeOrderIds: string[],
): Promise<Record<string, StoreOrderItem[]>> {
  if (storeOrderIds.length === 0) return {};
  const lines = await db
    .select({
      storeOrderId: storeOrderItems.storeOrderId,
      sku: storeOrderItems.sku,
      name: storeOrderItems.name,
      quantity: storeOrderItems.quantity,
      lineTotal: storeOrderItems.lineTotalSar,
      unitCost: sql<string | null>`${lineUnitCost}`,
      unitPrice: storeOrderItems.unitPriceSar,
      originalUnitPrice: storeOrderItems.originalUnitPriceSar,
    })
    .from(storeOrderItems)
    .innerJoin(storeOrders, eq(storeOrders.id, storeOrderItems.storeOrderId))
    .where(
      and(
        eq(storeOrderItems.accountId, acct),
        inArray(storeOrderItems.storeOrderId, storeOrderIds),
      ),
    )
    .orderBy(asc(storeOrderItems.storeOrderId), asc(storeOrderItems.position));
  const out: Record<string, StoreOrderItem[]> = {};
  for (const l of lines) {
    (out[l.storeOrderId] ??= []).push({
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      lineTotal: l.lineTotal === null ? null : Number(l.lineTotal),
      unitCost: l.unitCost === null ? null : Number(l.unitCost),
      unitPrice: l.unitPrice === null ? null : Number(l.unitPrice),
      originalUnitPrice: l.originalUnitPrice === null ? null : Number(l.originalUnitPrice),
    });
  }
  return out;
}

export interface StoreTopProduct {
  sku: string | null;
  name: string | null;
  quantity: number;
  orders: number;
  /** Sum of line totals incl. VAT, SAR (a line with no SAR figure adds nothing). */
  sales: number;
  /** Units × the cost in force on each order's date, over the units that HAVE a cost. */
  cogs: number;
  /** Units sold with no cost entered for their date — outside `cogs`. */
  unitsWithoutCost: number;
  /** Sales before VAT − COGS over the costed units; null when no unit has a cost. */
  grossProfit: number | null;
  /** Salla sale-price markdown, excl. VAT, SAR: Σ max(0, regular − sold) × units. */
  saleDiscount: number;
}

export interface StoreTopProducts {
  rows: StoreTopProduct[];
  /** Orders in the range with no product lines (uploads) — outside `rows`. */
  ordersWithoutProducts: number;
}

/**
 * The best-selling products over a range, by quantity — every order counts,
 * as everywhere in Store. A product is its SKU (a line with no SKU groups by
 * name). Only feed orders carry lines.
 */
export async function storeTopProducts(
  from: string,
  to: string,
  limit = 10,
): Promise<StoreTopProducts> {
  const acct = await getActiveAccountId();
  const key = sql`COALESCE(${storeOrderItems.sku}, ${storeOrderItems.name})`;
  const inRange = and(eq(storeOrders.accountId, acct), between(storeOrders.orderDate, from, to));
  // Per line: its quantity, its SAR total, and the unit cost in force.
  const costed = sql`${storeOrderItems.quantity} * ${lineUnitCost}`;
  const hasCost = sql`${lineUnitCost} IS NOT NULL`;
  const markdown = sql`GREATEST(${storeOrderItems.originalUnitPriceSar} - ${storeOrderItems.unitPriceSar}, 0) * ${storeOrderItems.quantity}`;
  const [rows, [bare]] = await Promise.all([
    db
      .select({
        cogs: sql<string>`COALESCE(SUM(${costed}), 0)`,
        unitsWithoutCost: sql<number>`COALESCE(SUM(${storeOrderItems.quantity}) FILTER (WHERE NOT (${hasCost})), 0)::int`,
        costedSales: sql<string | null>`SUM(${storeOrderItems.lineTotalSar}) FILTER (WHERE ${hasCost})`,
        sku: sql<string | null>`MAX(${storeOrderItems.sku})`,
        name: sql<string | null>`MAX(${storeOrderItems.name})`,
        quantity: sql<number>`SUM(${storeOrderItems.quantity})::int`,
        orders: sql<number>`COUNT(DISTINCT ${storeOrderItems.storeOrderId})::int`,
        sales: sql<string>`COALESCE(SUM(${storeOrderItems.lineTotalSar}), 0)`,
        saleDiscount: sql<string>`COALESCE(SUM(${markdown}), 0)`,
      })
      .from(storeOrderItems)
      .innerJoin(storeOrders, eq(storeOrders.id, storeOrderItems.storeOrderId))
      .where(and(inRange, eq(storeOrderItems.accountId, acct)))
      .groupBy(key)
      .orderBy(sql`SUM(${storeOrderItems.quantity}) DESC`, key)
      .limit(limit),
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(storeOrders)
      .where(
        and(
          inRange,
          sql`NOT EXISTS (SELECT 1 FROM ${storeOrderItems} WHERE ${storeOrderItems.storeOrderId} = ${storeOrders.id})`,
        ),
      ),
  ]);
  return {
    rows: rows.map(({ costedSales, cogs, ...r }) => ({
      ...r,
      sales: Number(r.sales),
      saleDiscount: Number(r.saleDiscount),
      cogs: Number(cogs),
      grossProfit:
        costedSales === null ? null : Math.round((beforeVat(Number(costedSales)) - Number(cogs)) * 100) / 100,
    })),
    ordersWithoutProducts: bare?.n ?? 0,
  };
}

/** The whole filtered set (capped) for CSV export. */
export async function storeOrdersForExport(
  f: Omit<StoreOrdersFilters, "page">,
  cap = 10_000,
): Promise<{ rows: StoreOrderRow[]; truncated: boolean }> {
  const acct = await getActiveAccountId();
  const conds = orderConds(acct, f);
  const sortCol =
    f.sort === "order_id"
      ? storeOrders.orderId
      : f.sort === "total_amount"
        ? storeOrders.totalAmount
        : storeOrders.orderDate;
  const orderBy = f.dir === "asc" ? asc(sortCol) : desc(sortCol);
  const rows = await db
    .select(ORDER_ROW_SELECT)
    .from(storeOrders)
    .leftJoin(storeUploadBatches, eq(storeUploadBatches.id, storeOrders.uploadBatchId))
    .where(and(...conds))
    .orderBy(orderBy, asc(storeOrders.id))
    .limit(cap + 1);
  const truncated = rows.length > cap;
  return {
    rows: rows.slice(0, cap).map(toOrderRow),
    truncated,
  };
}

/** The subset of `orderIds` that already exist for the active account. */
export async function existingStoreOrderIds(
  orderIds: string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const acct = await getActiveAccountId();
  const found = new Set<string>();
  // Chunk to keep the IN list bounded on very large files.
  for (let i = 0; i < orderIds.length; i += 1000) {
    const chunk = orderIds.slice(i, i + 1000);
    const rows = await db
      .select({ orderId: storeOrders.orderId })
      .from(storeOrders)
      .where(and(eq(storeOrders.accountId, acct), inArray(storeOrders.orderId, chunk)));
    for (const r of rows) found.add(r.orderId);
  }
  return found;
}

// ── Order cleanup (filtered hard-delete) ─────────────────────────────────────

export interface StoreCleanupMatch {
  from?: string;
  to?: string;
  batchId?: string;
  orderIds?: string[];
}

export interface StoreCleanupPreview {
  /** Matching order count. */
  orders: number;
  /** SUM(total_amount) over the matching orders, in SAR. */
  sumTotal: number;
  /** order_date span of the matching orders. */
  from: string | null;
  to: string | null;
}

/**
 * Did the user supply at least one real filter? The account scope is always
 * present in the SQL conditions, so we check the user-facing fields directly.
 * Callers MUST treat false as "match nothing" and refuse to delete.
 */
function hasAnyStoreCleanupFilter(f: StoreCleanupMatch): boolean {
  return Boolean(
    (f.from && f.to) ||
      f.batchId ||
      (f.orderIds && f.orderIds.length > 0),
  );
}

/**
 * WHERE conditions shared by preview + delete so they match EXACTLY the same
 * rows. Always account-scoped. `orderIds` is only turned into an `inArray` when
 * non-empty (an empty `inArray` is a SQL error — the ads tool hit this once).
 */
function buildStoreCleanupConds(f: StoreCleanupMatch, acct: string): SQL[] {
  const c: SQL[] = [eq(storeOrders.accountId, acct)];
  if (f.from && f.to) c.push(between(storeOrders.orderDate, f.from, f.to));
  if (f.batchId) c.push(eq(storeOrders.uploadBatchId, f.batchId));
  if (f.orderIds && f.orderIds.length > 0) {
    c.push(inArray(storeOrders.orderId, f.orderIds));
  }
  return c;
}

/** Count + summarize what an order-cleanup selection would remove. Read-only. */
export async function previewStoreCleanup(
  f: StoreCleanupMatch,
): Promise<StoreCleanupPreview> {
  if (!hasAnyStoreCleanupFilter(f)) {
    return { orders: 0, sumTotal: 0, from: null, to: null };
  }
  const conds = buildStoreCleanupConds(f, await getActiveAccountId());
  const [row] = await db
    .select({
      orders: sql<number>`count(*)::int`,
      sumTotal: sql<string | null>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
      minDate: sql<string | null>`MIN(${storeOrders.orderDate})`,
      maxDate: sql<string | null>`MAX(${storeOrders.orderDate})`,
    })
    .from(storeOrders)
    .where(and(...conds));
  return {
    orders: Number(row?.orders ?? 0),
    sumTotal: Number(row?.sumTotal ?? 0),
    from: row?.minDate ?? null,
    to: row?.maxDate ?? null,
  };
}

/**
 * Hard-delete every store order matching the selection. Returns the number of
 * rows removed. Refuses to run with no filter (returns 0) as a last-resort
 * guard against deleting everything. A sanctioned exit path for `store_orders`
 * alongside batch rollback (audited at the action layer).
 */
export async function deleteStoreOrders(
  f: StoreCleanupMatch,
  expectedRows?: number,
): Promise<number> {
  if (!hasAnyStoreCleanupFilter(f)) return 0;
  const conds = buildStoreCleanupConds(f, await getActiveAccountId());
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(storeOrders)
      .where(and(...conds))
      .returning({ id: storeOrders.id });
    // Exactly what was previewed, or nothing (W1-7).
    if (expectedRows !== undefined && deleted.length !== expectedRows) {
      throw new CleanupScopeChangedError(deleted.length, expectedRows);
    }
    return deleted.length;
  });
}

// ── Upload batches ───────────────────────────────────────────────────────────

export interface StoreBatchRow {
  id: string;
  fileName: string;
  uploadedByName: string | null;
  uploadedAt: Date;
  rowsInserted: number;
  rowsUpdated: number;
  upsert: boolean;
  status: string;
  rolledBackAt: Date | null;
  /** Who rolled it back — a PK join off `rolled_back_by_user_id`. */
  rolledBackByName: string | null;
}

const storeRollbacker = alias(users, "store_rollbacker");

export interface StoreWriteRow {
  orderId: string;
  orderDate: string;
  totalAmount: string;
  attributes: Record<string, string | number>;
}

/**
 * Transactionally write one upload batch: create the batch, INSERT new orders
 * under it, and UPDATE existing ones in place (last-value-wins) WITHOUT changing
 * their `upload_batch_id` (so a rollback of THIS batch deletes only its
 * inserts). Account is passed explicitly (not via cookie) so it's testable.
 */
export async function writeStoreBatch(opts: {
  accountId: string;
  fileName: string;
  uploadedByUserId: string;
  upsert: boolean;
  inserts: StoreWriteRow[];
  updates: StoreWriteRow[];
  /**
   * Configured custom fields that had a mapped COLUMN in this file. Anything
   * not listed here had no column at all, so the file says nothing about it
   * and its stored value must survive the update untouched. Omitted (or empty)
   * = treat every key in the row as authoritative, i.e. the old
   * replace-the-whole-object behaviour.
   */
  presentFieldKeys?: string[];
  /**
   * Run inside this write's OWN transaction, after the rows land — the hook the
   * notification producer uses, so "the store upload finished" can never
   * outlive a rolled-back import.
   */
  afterWrite?: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    result: { batchId: string; rowsInserted: number; rowsUpdated: number },
  ) => Promise<void>;
}): Promise<{ batchId: string; rowsInserted: number; rowsUpdated: number }> {
  const CHUNK = 500;
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(storeUploadBatches)
      .values({
        accountId: opts.accountId,
        fileName: opts.fileName,
        uploadedByUserId: opts.uploadedByUserId,
        upsert: opts.upsert,
        rowsInserted: opts.inserts.length,
        rowsUpdated: opts.updates.length,
      })
      .returning({ id: storeUploadBatches.id });
    const bid = batch!.id;

    for (let i = 0; i < opts.inserts.length; i += CHUNK) {
      const chunk = opts.inserts.slice(i, i + CHUNK);
      await tx.insert(storeOrders).values(
        chunk.map((r) => ({
          accountId: opts.accountId,
          orderId: r.orderId,
          orderDate: r.orderDate,
          totalAmount: r.totalAmount,
          attributes: r.attributes,
          uploadBatchId: bid,
        })),
      );
    }

    // Upsert updates PATCH attributes rather than replacing them. A store
    // export is often a partial view (one team's columns), so replacing wiped
    // every custom value whose column simply wasn't in that file. Semantics:
    //   column PRESENT + value  → set the key
    //   column PRESENT + blank  → REMOVE the key (an explicit clear still works)
    //   column ABSENT           → leave the key exactly as it is
    // Core columns (date, amount) are unconditional as before.
    //
    // One UPDATE … FROM (VALUES …) per chunk instead of one statement per row,
    // mirroring the ads `bulkUpdateMetricValues`. A 5k-row upsert was 5k
    // sequential round-trips on a single connection; the patch is built PER ROW
    // into the VALUES set, so the semantics above are unchanged.
    const present = opts.presentFieldKeys;
    for (let i = 0; i < opts.updates.length; i += CHUNK) {
      const chunk = opts.updates.slice(i, i + CHUNK);
      const literal = (keys: string[]) =>
        // Bound as ONE text[] literal, not as a JS array: drizzle expands an
        // array in a raw sql template into `($1,$2)` — a row expression, which
        // is a syntax error here (and `()` when nothing is cleared).
        `{${keys.map((k) => `"${k.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
      const tuples = chunk.map((r) => {
        // Keys the file HAS a column for but left blank on this row → clear.
        const cleared = present ? present.filter((k) => !(k in r.attributes)) : [];
        // The same list for an order the feed holds: its own keys are not the
        // file's to clear.
        const clearedHeld = cleared.filter((k) => !FEED_OWNED.has(k));
        return sql`(${r.orderId}::text, ${r.orderDate}::date, ${r.totalAmount}::numeric, ${literal(cleared)}::text[], ${literal(clearedHeld)}::text[], ${JSON.stringify(r.attributes)}::jsonb)`;
      });
      // THE SALLA FEED WINS (2026-11): a row the connector has written
      // (`connector_updated_at` set) keeps its date, total and feed-owned
      // attributes; the file only patches the other keys. Decided on the
      // STORED row, not on what validation saw, so an order the webhook
      // delivered between preview and commit is still protected.
      await tx.execute(sql`
        UPDATE store_orders AS o SET
          order_date = CASE WHEN o.connector_updated_at IS NULL THEN v.order_date ELSE o.order_date END,
          total_amount = CASE WHEN o.connector_updated_at IS NULL THEN v.total_amount ELSE o.total_amount END,
          attributes = CASE WHEN o.connector_updated_at IS NULL THEN ${
            present
              ? // `- text[]` drops the cleared keys, `||` merges the new values
                // in; everything else in the stored object carries through.
                sql`COALESCE(o.attributes, '{}'::jsonb) - v.cleared || v.patch`
              : sql`v.patch`
          } ELSE (COALESCE(o.attributes, '{}'::jsonb) - v.cleared_held) || (v.patch - ${literal([...FEED_OWNED])}::text[]) END,
          updated_at = now()
        FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(
          order_id, order_date, total_amount, cleared, cleared_held, patch
        )
        WHERE o.order_id = v.order_id AND o.account_id = ${opts.accountId}
      `);
    }
    const result = {
      batchId: bid,
      rowsInserted: opts.inserts.length,
      rowsUpdated: opts.updates.length,
    };
    await opts.afterWrite?.(tx, result);
    return result;
  });
}

/** The last `limit` upload batches for the active account (recent-batches list). */
export async function listStoreBatches(limit = 10): Promise<StoreBatchRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: storeUploadBatches.id,
      fileName: storeUploadBatches.fileName,
      uploadedByName: users.name,
      uploadedAt: storeUploadBatches.uploadedAt,
      rowsInserted: storeUploadBatches.rowsInserted,
      rowsUpdated: storeUploadBatches.rowsUpdated,
      upsert: storeUploadBatches.upsert,
      status: storeUploadBatches.status,
      rolledBackAt: storeUploadBatches.rolledBackAt,
      rolledBackByName: storeRollbacker.name,
    })
    .from(storeUploadBatches)
    .leftJoin(users, eq(users.id, storeUploadBatches.uploadedByUserId))
    .leftJoin(storeRollbacker, eq(storeRollbacker.id, storeUploadBatches.rolledBackByUserId))
    .where(eq(storeUploadBatches.accountId, acct))
    .orderBy(desc(storeUploadBatches.uploadedAt))
    .limit(limit);
  return rows;
}

/**
 * How many of a batch's INSERTED orders a later upsert has revised since the
 * batch landed (`updated_at > uploaded_at`). Rolling back deletes those rows,
 * discarding the newer values — the confirm dialog surfaces the count so it's a
 * decision rather than a surprise. (Rows the batch merely UPDATED keep their
 * original batch id and are never deleted by a rollback, so they're out of
 * scope by construction.)
 */
export async function storeBatchRowsUpdatedSince(
  accountId: string,
  batchId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.accountId, accountId),
        eq(storeOrders.uploadBatchId, batchId),
        // Compared INSIDE SQL against the batch's stored timestamp — a JS
        // round-trip truncates microseconds and would report every freshly
        // inserted order as already revised.
        sql`${storeOrders.updatedAt} > (
          SELECT ${storeUploadBatches.uploadedAt} FROM ${storeUploadBatches}
          WHERE ${storeUploadBatches.id} = ${batchId}
        )`,
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Every attribute key still stored on this account's orders. A field's key
 * must not reuse one of these: deleting a field leaves its values in
 * `attributes`, so a re-created field with the same label (and so the same
 * key) resurrected them under the NEW field's type — a deleted text "Coupon"
 * holding SUMMER came back under a number field (W1-13, audit B-26). One
 * scan, run only when a field is created.
 */
export async function storeAttributeKeysInUse(accountId: string): Promise<Set<string>> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT jsonb_object_keys(${storeOrders.attributes}) AS key
    FROM ${storeOrders}
    WHERE ${storeOrders.accountId} = ${accountId}
  `)) as unknown as Array<{ key: string }>;
  return new Set(rows.map((r) => r.key));
}

/**
 * What a NEW field's key and position must avoid: every key the account's
 * fields use, plus `storeAttributeKeysInUse`, and the highest `sort_order`
 * (0 when there are none) so the field lands last. Read only on create.
 */
export async function storeFieldCreationContext(
  accountId: string,
): Promise<{ takenKeys: Set<string>; maxSortOrder: number }> {
  const fields = await db
    .select({ key: storeOrderFields.key, sortOrder: storeOrderFields.sortOrder })
    .from(storeOrderFields)
    .where(eq(storeOrderFields.accountId, accountId));
  const inUse = await storeAttributeKeysInUse(accountId);
  return {
    takenKeys: new Set([...fields.map((r) => r.key), ...inUse]),
    maxSortOrder: fields.reduce((m, r) => Math.max(m, r.sortOrder), 0),
  };
}
