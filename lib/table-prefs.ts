"use client";

import { resetTableColumns, setTableColumns } from "@/app/actions/user-prefs";
import type { TableColumnPref } from "@/lib/table-columns";

/**
 * Client write-through for remembered table columns — `lib/filter-prefs.ts`'s
 * pattern, for the other half of a table's state.
 *
 * Hiding four columns in a row is ONE write, not four: the queue merges by
 * table key, last value wins. Nothing is awaited — a column toggle must feel
 * instant, and a failed save is a console warning, never an interruption.
 */

/** One burst of column changes is one write. */
export const TABLE_PREF_DEBOUNCE_MS = 400;

export interface TablePrefEntry extends TableColumnPref {
  tableKey: string;
  /** Reset sends no state: the row is deleted. */
  reset?: boolean;
}

/**
 * Merge a burst by TABLE KEY, last write wins — the pure half, so the batching
 * is testable without a timer or a network. A reset issued after a toggle in
 * the same burst must end as the reset.
 */
export function mergeTableEntries(
  pending: readonly TablePrefEntry[],
  incoming: readonly TablePrefEntry[],
): TablePrefEntry[] {
  const byKey = new Map<string, TablePrefEntry>();
  for (const e of [...pending, ...incoming]) byKey.set(e.tableKey, e);
  return [...byKey.values()];
}

let queued: TablePrefEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  const batch = queued;
  queued = [];
  timer = null;
  for (const entry of batch) {
    const call = entry.reset
      ? resetTableColumns({ tableKey: entry.tableKey })
      : setTableColumns({
          tableKey: entry.tableKey,
          hidden: entry.hidden,
          order: entry.order,
        });
    void call.then(
      (res) => {
        if (!res?.ok) console.warn("Column preferences were not saved.");
      },
      (err) => console.warn("Column preferences were not saved:", err),
    );
  }
}

/** Queue a table's columns for saving. Debounced per burst, never awaited. */
export function queueTablePrefs(entry: TablePrefEntry): void {
  queued = mergeTableEntries(queued, [entry]);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, TABLE_PREF_DEBOUNCE_MS);
}
