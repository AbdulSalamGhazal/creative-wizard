import { and, asc, between, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  storeOrders,
  storeOrderFields,
  storeUploadBatches,
  users,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { isCoreKey, type StoreField, type StoreFieldType } from "@/store/fields";

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
  }));
}

// ── Orders (paginated) ───────────────────────────────────────────────────────

export interface StoreOrderRow {
  id: string;
  orderId: string;
  orderDate: string;
  totalAmount: number;
  attributes: Record<string, unknown>;
}

export interface StoreOrdersFilters {
  from?: string;
  to?: string;
  q?: string;
  page: number;
  /** Core sort key only ('order_id' | 'order_date' | 'total_amount'); custom cols sort client-side. */
  sort: "order_id" | "order_date" | "total_amount";
  dir: "asc" | "desc";
}

export interface StoreOrdersResult {
  rows: StoreOrderRow[];
  /** Total matching the filter (for the pager). */
  total: number;
  /** SUM(total_amount) over the WHOLE filtered set, in SAR (for the footer). */
  sumTotal: number;
  page: number;
  pageSize: number;
}

export const STORE_PAGE_SIZE = 100;

function orderConds(acct: string, f: StoreOrdersFilters): SQL[] {
  const c: SQL[] = [eq(storeOrders.accountId, acct)];
  if (f.from) c.push(gte(storeOrders.orderDate, f.from));
  if (f.to) c.push(lte(storeOrders.orderDate, f.to));
  if (f.q && f.q.trim()) c.push(ilike(storeOrders.orderId, `%${f.q.trim()}%`));
  return c;
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
      .select({
        id: storeOrders.id,
        orderId: storeOrders.orderId,
        orderDate: storeOrders.orderDate,
        totalAmount: storeOrders.totalAmount,
        attributes: storeOrders.attributes,
      })
      .from(storeOrders)
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
    rows: rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderDate: r.orderDate,
      totalAmount: Number(r.totalAmount),
      attributes: (r.attributes ?? {}) as Record<string, unknown>,
    })),
    total: agg?.n ?? 0,
    sumTotal: Number(agg?.sum ?? 0),
    page,
    pageSize: STORE_PAGE_SIZE,
  };
}

/** The whole filtered set (capped) for CSV export. */
export async function storeOrdersForExport(
  f: Omit<StoreOrdersFilters, "page">,
  cap = 10_000,
): Promise<{ rows: StoreOrderRow[]; truncated: boolean }> {
  const acct = await getActiveAccountId();
  const conds = orderConds(acct, { ...f, page: 1 });
  const sortCol =
    f.sort === "order_id"
      ? storeOrders.orderId
      : f.sort === "total_amount"
        ? storeOrders.totalAmount
        : storeOrders.orderDate;
  const orderBy = f.dir === "asc" ? asc(sortCol) : desc(sortCol);
  const rows = await db
    .select({
      id: storeOrders.id,
      orderId: storeOrders.orderId,
      orderDate: storeOrders.orderDate,
      totalAmount: storeOrders.totalAmount,
      attributes: storeOrders.attributes,
    })
    .from(storeOrders)
    .where(and(...conds))
    .orderBy(orderBy, asc(storeOrders.id))
    .limit(cap + 1);
  const truncated = rows.length > cap;
  return {
    rows: rows.slice(0, cap).map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderDate: r.orderDate,
      totalAmount: Number(r.totalAmount),
      attributes: (r.attributes ?? {}) as Record<string, unknown>,
    })),
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
export async function deleteStoreOrders(f: StoreCleanupMatch): Promise<number> {
  if (!hasAnyStoreCleanupFilter(f)) return 0;
  const conds = buildStoreCleanupConds(f, await getActiveAccountId());
  const deleted = await db
    .delete(storeOrders)
    .where(and(...conds))
    .returning({ id: storeOrders.id });
  return deleted.length;
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
}

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

    for (const r of opts.updates) {
      await tx
        .update(storeOrders)
        .set({
          orderDate: r.orderDate,
          totalAmount: r.totalAmount,
          attributes: r.attributes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storeOrders.accountId, opts.accountId),
            eq(storeOrders.orderId, r.orderId),
          ),
        );
    }

    return { batchId: bid, rowsInserted: opts.inserts.length, rowsUpdated: opts.updates.length };
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
    })
    .from(storeUploadBatches)
    .leftJoin(users, eq(users.id, storeUploadBatches.uploadedByUserId))
    .where(eq(storeUploadBatches.accountId, acct))
    .orderBy(desc(storeUploadBatches.uploadedAt))
    .limit(limit);
  return rows;
}
