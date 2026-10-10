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
}

/**
 * Merge a burst by TABLE KEY, last write wins — the pure half, so the batching
 * is testable without a timer or a network.
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
    void setTableColumns({
      tableKey: entry.tableKey,
      hidden: entry.hidden,
      order: entry.order,
    }).then(
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

/**
 * RESET, awaited — and it is awaited for a reason.
 *
 * On a URL-backed table the reset also strips `hide`/`order` from the URL, and
 * a bare URL is indistinguishable from "no opinion": the server falls through
 * to the preference (`resolveColumnPrefs`). So if the delete is still sitting
 * in the debounce when that render happens, the row the user just reset comes
 * straight back and the control looks broken. A deliberate click can afford
 * the round-trip; a per-toggle write cannot, which is why only this path waits.
 *
 * It also DROPS any queued write for the same table first: a toggle from a
 * moment ago must not fire after the delete and recreate the row.
 */
export async function resetTablePrefsNow(tableKey: string): Promise<void> {
  queued = queued.filter((e) => e.tableKey !== tableKey);
  if (queued.length === 0 && timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    const res = await resetTableColumns({ tableKey });
    if (!res?.ok) console.warn("Column preferences were not reset.");
  } catch (err) {
    console.warn("Column preferences were not reset:", err);
  }
}
