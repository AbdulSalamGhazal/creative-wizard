"use server";

import { requireAuth } from "@/lib/auth";
import { storeOrdersForExport, listStoreFields } from "@/db/queries/store";
import { storeOrdersFiltersSchema } from "@/validators/store";
import { rowsToCsv, type CsvColumn } from "@/lib/csv-export";
import type { StoreOrderRow } from "@/db/queries/store";

/**
 * Build the CSV for the currently-filtered orders (capped at 10k rows). Runs on
 * the server so we never ship the whole table to the client. Columns = core +
 * every custom field (not just show-in-table ones — an export should be full).
 */
export async function exportStoreOrders(
  input: unknown,
): Promise<{ ok: boolean; csv?: string; truncated?: boolean; error?: string }> {
  try {
    await requireAuth(); // brand scoping happens in the queries
    const f = storeOrdersFiltersSchema.parse(input ?? {});
    const [fields, { rows, truncated }] = await Promise.all([
      listStoreFields(),
      storeOrdersForExport({ from: f.from, to: f.to, q: f.q, sort: f.sort, dir: f.dir }),
    ]);

    const custom = fields.filter((fl) => !fl.core);
    const columns: CsvColumn<StoreOrderRow>[] = [
      { key: "order_id", label: "Order ID", value: (r) => r.orderId },
      { key: "order_date", label: "Order date", value: (r) => r.orderDate },
      { key: "total_amount", label: "Total (SAR)", value: (r) => r.totalAmount },
      ...custom.map((fl) => ({
        key: fl.key,
        label: fl.label,
        value: (r: StoreOrderRow) => {
          const v = r.attributes[fl.key];
          return v === undefined || v === null ? "" : String(v);
        },
      })),
    ];

    return { ok: true, csv: rowsToCsv(rows, columns), truncated };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Export failed." };
  }
}
