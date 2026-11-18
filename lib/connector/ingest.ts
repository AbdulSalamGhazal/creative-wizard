import { db } from "@/lib/db";
import {
  insertConnectorEvents,
  listStoreConnections,
  touchConnections,
  upsertConnectorOrders,
  type ConnectorEventRow,
  type ConnectorOrderWrite,
  type ConnectorVia,
} from "@/db/queries/store-connector";
import { connectorEventSchema, type ConnectorEvent } from "@/validators/connector";
import { CONNECTOR_OWNED_KEYS, mapConnectorOrder } from "@/lib/connector/map-order";

/**
 * `record` keeps every event in the raw log and touches no order — Wizard's
 * own dry run for the test phase. `live` also applies order events. Anything
 * but the literal `live` is `record`: a missing or misspelt setting must fail
 * towards "nothing changed".
 */
export type ConnectorMode = "record" | "live";

export function connectorMode(): ConnectorMode {
  return process.env.CONNECTOR_MODE === "live" ? "live" : "record";
}

export interface IngestResult {
  /** Events in the batch that were well-formed. */
  received: number;
  /** Of those, new to the raw log (the rest were redeliveries). */
  stored: number;
  /** Orders inserted or updated in `store_orders`. */
  applied: number;
  /** Order events that could not become a Store row (kept raw). */
  unreadable: number;
  /** Events for a store no brand is linked to (kept raw). */
  unknownStore: number;
}

function instant(v: string | null | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * THE one entry path of the connector feed — the webhook, the catch-up pull
 * and the backfill all end here. One transaction per batch:
 *
 * 1. every well-formed event goes into the raw log (dedup by event id);
 * 2. in `live` mode, order events of a linked store are applied to
 *    `store_orders`, newest version per order, behind the ordering guard;
 * 3. the touched stores are stamped "an event just arrived".
 *
 * No user, no active brand: nothing here may call `auth()` or
 * `getActiveAccountId()`, and every query runs on the transaction.
 */
export async function ingestConnectorEvents(
  rawEvents: unknown[],
  via: ConnectorVia,
  mode: ConnectorMode = connectorMode(),
): Promise<IngestResult> {
  const events: ConnectorEvent[] = [];
  for (const raw of rawEvents) {
    const parsed = connectorEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  const result: IngestResult = {
    received: events.length,
    stored: 0,
    applied: 0,
    unreadable: 0,
    unknownStore: 0,
  };
  if (events.length === 0) return result;

  return db.transaction(async (tx) => {
    const connections = await listStoreConnections(tx);
    const accountOf = new Map(connections.map((c) => [c.storeKey, c.accountId]));

    const rows: ConnectorEventRow[] = [];
    // Newest version per (account, order): one row may be written only once
    // per statement, and an older event must not land after a newer one.
    const newest = new Map<string, ConnectorOrderWrite>();
    const touched = new Set<string>();

    for (const e of events) {
      const accountId = accountOf.get(e.store) ?? null;
      const occurredAt = instant(e.occurred_at);
      rows.push({
        eventId: e.id,
        accountId,
        storeKey: e.store,
        type: e.type,
        occurredAt,
        via,
        payload: e,
      });
      if (!accountId) {
        result.unknownStore++;
        continue;
      }
      touched.add(accountId);
      if (!e.type.startsWith("order.")) continue;

      const mapped = mapConnectorOrder(e.data?.order);
      if (!mapped) {
        result.unreadable++;
        continue;
      }
      const version = instant(mapped.updatedAt) ?? occurredAt ?? new Date();
      const key = `${accountId}:${mapped.orderId}`;
      const seen = newest.get(key);
      if (seen && seen.connectorUpdatedAt.getTime() > version.getTime()) continue;
      newest.set(key, {
        accountId,
        orderId: mapped.orderId,
        orderDate: mapped.orderDate,
        totalAmount: mapped.totalAmount,
        attributes: mapped.attributes,
        connectorUpdatedAt: version,
      });
    }

    result.stored = await insertConnectorEvents(tx, rows);
    if (mode === "live" && newest.size > 0) {
      result.applied = await upsertConnectorOrders(tx, [...newest.values()], CONNECTOR_OWNED_KEYS);
    }
    await touchConnections(tx, [...touched]);
    return result;
  });
}

/**
 * A pulled order → the event shape the ingest reads. The id is synthesized
 * from the order's own version, so pulling the same version twice is a no-op
 * in the raw log.
 */
export function pulledOrderEvent(store: string, order: Record<string, unknown>): unknown {
  const reference = String(order.reference ?? "");
  const updatedAt = typeof order.updated_at === "string" ? order.updated_at : "";
  return {
    id: `pull:${store}:${reference}:${updatedAt}`.slice(0, 200),
    type: "order.snapshot",
    store,
    occurred_at: updatedAt || null,
    data: { order },
  };
}
