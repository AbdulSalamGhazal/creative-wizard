import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  storeConnections,
  storeConnectorEvents,
  storeOrderItems,
  storeOrders,
} from "@/db/schema";
import type { MappedOrderItem } from "@/lib/connector/map-order";
import { getActiveAccountId } from "@/lib/tenant";
import { riyadhToday } from "@/lib/connector/time";

/**
 * The Salla connector feed's query layer. Two kinds of caller:
 *
 * - the FEED (webhook, catch-up pull, backfill) has NO user and NO active
 *   brand: every function it uses takes the account id explicitly and an
 *   `exec` (the ingest transaction — prod's pool is ONE connection, so a
 *   query on the global `db` inside that transaction would deadlock);
 * - the PAGES read through `getActiveAccountId()` like every other module.
 */

type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConnectorVia = "webhook" | "pull";

export interface ConnectionRow {
  accountId: string;
  storeKey: string;
  pullCursor: string | null;
}

/** Every linked store. A handful of rows — one per connected brand. */
export async function listStoreConnections(exec: Exec = db): Promise<ConnectionRow[]> {
  return exec
    .select({
      accountId: storeConnections.accountId,
      storeKey: storeConnections.storeKey,
      pullCursor: storeConnections.pullCursor,
    })
    .from(storeConnections);
}

export interface ConnectorEventRow {
  eventId: string;
  accountId: string | null;
  storeKey: string;
  type: string;
  occurredAt: Date | null;
  via: ConnectorVia;
  payload: unknown;
}

const CHUNK = 500;

/**
 * Append events to the raw log. A redelivered event (same `event_id`) is a
 * no-op. Returns how many were NEW.
 */
export async function insertConnectorEvents(
  exec: Exec,
  rows: ConnectorEventRow[],
): Promise<number> {
  let stored = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const inserted = await exec
      .insert(storeConnectorEvents)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoNothing({ target: storeConnectorEvents.eventId })
      .returning({ id: storeConnectorEvents.id });
    stored += inserted.length;
  }
  return stored;
}

export interface ConnectorOrderWrite {
  accountId: string;
  orderId: string;
  orderDate: string;
  totalAmount: string;
  /** Feed-owned keys that have a value. */
  attributes: Record<string, string | number>;
  /** The version's timestamp — the ordering guard compares on it. */
  connectorUpdatedAt: Date;
  /** The order's product lines; replace the stored set when this version applies. */
  items: MappedOrderItem[];
}

/**
 * Insert-or-update orders from the feed. ONE statement per chunk, and each
 * `(account, order)` may appear only ONCE in `rows` (the caller keeps the
 * newest) — Postgres refuses to touch a row twice in one ON CONFLICT.
 *
 * - a new order is inserted with NO upload batch;
 * - an existing one is updated ONLY when this version is not older than the
 *   one already applied (the ordering guard) — an order no connector write
 *   has touched yet (an uploaded one) is always taken over;
 * - `attributes` is PATCHED: the feed-owned keys are replaced as a set (a key
 *   with no value is removed), every other stored key is left alone;
 * - `upload_batch_id` is never changed;
 * - the order's product lines (`store_order_items`) are REPLACED as a set for
 *   exactly the rows written — so an older version never replaces newer lines.
 *
 * Returns the number of rows written (inserted + updated).
 */
export async function upsertConnectorOrders(
  exec: Exec,
  rows: ConnectorOrderWrite[],
  ownedKeys: readonly string[],
): Promise<number> {
  const owned = `{${ownedKeys.join(",")}}`;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await exec
      .insert(storeOrders)
      .values(
        rows.slice(i, i + CHUNK).map((r) => ({
          accountId: r.accountId,
          orderId: r.orderId,
          orderDate: r.orderDate,
          totalAmount: r.totalAmount,
          attributes: r.attributes,
          connectorUpdatedAt: r.connectorUpdatedAt,
          uploadBatchId: null,
        })),
      )
      .onConflictDoUpdate({
        target: [storeOrders.accountId, storeOrders.orderId],
        set: {
          orderDate: sql`excluded.order_date`,
          totalAmount: sql`excluded.total_amount`,
          attributes: sql`(COALESCE(${storeOrders.attributes}, '{}'::jsonb) - ${owned}::text[]) || excluded.attributes`,
          connectorUpdatedAt: sql`excluded.connector_updated_at`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${storeOrders.connectorUpdatedAt} IS NULL OR ${storeOrders.connectorUpdatedAt} <= excluded.connector_updated_at`,
      })
      .returning({ id: storeOrders.id, accountId: storeOrders.accountId, orderId: storeOrders.orderId });
    written += res.length;
    await replaceOrderItems(exec, res, rows);
  }
  return written;
}

/** Delete-then-insert the lines of the orders a write just applied. */
async function replaceOrderItems(
  exec: Exec,
  applied: { id: string; accountId: string; orderId: string }[],
  rows: ConnectorOrderWrite[],
): Promise<void> {
  if (applied.length === 0) return;
  const itemsOf = new Map(rows.map((r) => [`${r.accountId}:${r.orderId}`, r.items]));
  await exec.delete(storeOrderItems).where(
    inArray(
      storeOrderItems.storeOrderId,
      applied.map((a) => a.id),
    ),
  );
  const lines = applied.flatMap((a) =>
    (itemsOf.get(`${a.accountId}:${a.orderId}`) ?? []).map((l) => ({
      accountId: a.accountId,
      storeOrderId: a.id,
      position: l.position,
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      lineTotalSar: l.lineTotalSar,
      unitPriceSar: l.unitPriceSar,
      originalUnitPriceSar: l.originalUnitPriceSar,
    })),
  );
  for (let i = 0; i < lines.length; i += CHUNK) {
    await exec.insert(storeOrderItems).values(lines.slice(i, i + CHUNK));
  }
}

/** Stamp "an event just arrived" on the stores a batch touched. */
export async function touchConnections(exec: Exec, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  await exec
    .update(storeConnections)
    .set({ lastEventAt: sql`now()`, updatedAt: sql`now()` })
    .where(inArray(storeConnections.accountId, accountIds));
}

/** Record how a catch-up pull ended. The cursor moves only on success. */
export async function recordPullResult(
  accountId: string,
  result: { ok: true; cursor: string | null } | { ok: false; error: string },
  exec: Exec = db,
): Promise<void> {
  await exec
    .update(storeConnections)
    .set(
      result.ok
        ? {
            lastPullAt: sql`now()`,
            lastPullError: null,
            ...(result.cursor ? { pullCursor: result.cursor } : {}),
            updatedAt: sql`now()`,
          }
        : {
            lastPullAt: sql`now()`,
            lastPullError: result.error.slice(0, 500),
            updatedAt: sql`now()`,
          },
    )
    .where(eq(storeConnections.accountId, accountId));
}

/**
 * Which of these order ids the FEED already holds for the account — the
 * orders an upload must not overwrite. Takes the account explicitly: the
 * upload action has already resolved it.
 */
export async function connectorHeldOrderIds(
  accountId: string,
  orderIds: string[],
  exec: Exec = db,
): Promise<Set<string>> {
  const held = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 1000) {
    const rows = await exec
      .select({ orderId: storeOrders.orderId })
      .from(storeOrders)
      .where(
        and(
          eq(storeOrders.accountId, accountId),
          inArray(storeOrders.orderId, orderIds.slice(i, i + 1000)),
          isNotNull(storeOrders.connectorUpdatedAt),
        ),
      );
    for (const r of rows) held.add(r.orderId);
  }
  return held;
}

export interface StoreConnectionStatus {
  storeKey: string;
  /** When the newest order event was received (ISO), or null before the first. */
  lastEventAt: string | null;
  lastPullAt: string | null;
  lastPullError: string | null;
  /** Orders created today (Riyadh) that the feed holds. */
  ordersToday: number;
}

/**
 * The active brand's connection, or null when the brand isn't linked to a
 * Salla store. Two indexed reads; `cache()`d so the page and its metadata
 * share one.
 */
export const storeConnectionStatus = cache(async (): Promise<StoreConnectionStatus | null> => {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({
      storeKey: storeConnections.storeKey,
      lastEventAt: storeConnections.lastEventAt,
      lastPullAt: storeConnections.lastPullAt,
      lastPullError: storeConnections.lastPullError,
    })
    .from(storeConnections)
    .where(eq(storeConnections.accountId, acct))
    .limit(1);
  if (!row) return null;
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.accountId, acct),
        eq(storeOrders.orderDate, riyadhToday()),
        isNotNull(storeOrders.connectorUpdatedAt),
      ),
    );
  return {
    storeKey: row.storeKey,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    lastPullAt: row.lastPullAt?.toISOString() ?? null,
    lastPullError: row.lastPullError,
    ordersToday: count?.n ?? 0,
  };
});
