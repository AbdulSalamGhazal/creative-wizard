import { listStoreConnections, recordPullResult } from "@/db/queries/store-connector";
import { ConnectorApiError, pullOrders } from "@/lib/connector/client";
import { ingestConnectorEvents, pulledOrderEvent } from "@/lib/connector/ingest";

/** With no cursor yet, the nightly pull looks back this far; the backfill script does the rest. */
const FIRST_PULL_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export interface StoreSyncResult {
  store: string;
  ok: boolean;
  orders: number;
  applied: number;
  error?: string;
}

function describe(err: unknown): string {
  if (err instanceof ConnectorApiError) return `${err.status} ${err.code}`;
  return err instanceof Error ? err.message : "unknown error";
}

/**
 * Catch up every linked store from the connector's read API: orders changed
 * since the stored cursor, through the same ingest as the webhook. One
 * store's failure never stops the others; each store's outcome is recorded
 * on its connection (the Orders page reads it). `backfill` ignores the
 * cursor and walks everything from `createdFrom`.
 */
export async function syncAllStores(opts: {
  deadlineMs?: number;
  backfillFrom?: string;
}): Promise<StoreSyncResult[]> {
  const results: StoreSyncResult[] = [];
  for (const c of await listStoreConnections()) {
    let applied = 0;
    try {
      const updatedSince = opts.backfillFrom
        ? null
        : (c.pullCursor ?? new Date(Date.now() - FIRST_PULL_LOOKBACK_MS).toISOString());
      const pulled = await pullOrders({
        store: c.storeKey,
        updatedSince,
        createdFrom: opts.backfillFrom,
        deadlineMs: opts.deadlineMs,
        onPage: async (orders) => {
          const r = await ingestConnectorEvents(
            orders.map((o) => pulledOrderEvent(c.storeKey, o)),
            "pull",
          );
          applied += r.applied;
        },
      });
      if (!pulled.complete) {
        const error = "ran out of time before the last page";
        await recordPullResult(c.accountId, { ok: false, error });
        results.push({ store: c.storeKey, ok: false, orders: pulled.orders, applied, error });
        continue;
      }
      await recordPullResult(c.accountId, { ok: true, cursor: pulled.newestUpdatedAt });
      results.push({ store: c.storeKey, ok: true, orders: pulled.orders, applied });
    } catch (err) {
      const error = describe(err);
      console.error(`[connector] sync failed for ${c.storeKey}:`, error);
      await recordPullResult(c.accountId, { ok: false, error });
      results.push({ store: c.storeKey, ok: false, orders: 0, applied, error });
    }
  }
  return results;
}
