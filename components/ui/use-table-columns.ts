"use client";

import { useCallback, useMemo, useState } from "react";
import { queueTablePrefs } from "@/lib/table-prefs";
import {
  mergeColumnOrder,
  mergeHiddenColumns,
  moveColumn,
  type TableColumnPref,
  type TableKey,
} from "@/lib/table-columns";

/**
 * The columns state for one `DataTable`, plus the write-through that remembers
 * it per user per brand.
 *
 * TWO SHAPES, one hook, because the app has two kinds of table:
 *  · **Local** (the default) — the page resolves the preference server-side and
 *    hands it in as `initial`; this hook owns the state from there. The simplest
 *    case and the template for the phase-2 sweep.
 *  · **Controlled** (`value` + `onChange`) — the URL owns the columns, because
 *    saved views snapshot the query string. The hook then holds no state: it
 *    reports what the URL says and hands changes back to the caller to write,
 *    while still saving the preference. Two writers, one source of truth.
 *
 * Either way the SAVE is the same: debounced, merged, fire-and-forget, and a
 * reset DELETES the row so the next bare visit starts at the config.
 */
export interface UseTableColumnsResult {
  hidden: string[];
  order: string[];
  /** Spread straight onto `<DataTable />` — the whole control in one object. */
  tableProps: {
    columnsKey: string;
    hidden: string[];
    order: string[];
    onReorder: (order: string[]) => void;
    onToggleColumn: (key: string) => void;
    onMoveColumn: (key: string, delta: number) => void;
    onResetColumns: () => void;
    columnsDirty: boolean;
  };
}

export function useTableColumns({
  tableKey,
  hideable,
  defaults,
  initial,
  value,
  onChange,
}: {
  tableKey: TableKey;
  /** Column keys that MAY be hidden (everything but the pinned one). */
  hideable: readonly string[];
  /** The non-pinned column keys in config order. */
  defaults: readonly string[];
  /** The server-resolved preference, for the local shape. */
  initial?: TableColumnPref;
  /** The current value, for the URL-backed shape. Presence = controlled. */
  value?: TableColumnPref;
  /** Where a change goes besides the preference (the URL writer). */
  onChange?: (next: TableColumnPref) => void;
}): UseTableColumnsResult {
  const seed = useMemo<TableColumnPref>(
    () => ({
      hidden: mergeHiddenColumns(initial?.hidden ?? [], hideable),
      order: initial?.order?.length ? mergeColumnOrder(initial.order, defaults) : [],
    }),
    // The seed is exactly that — later server values arrive through `value`
    // (controlled) or not at all, so re-seeding on every render would fight the
    // user's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableKey],
  );
  const [local, setLocal] = useState<TableColumnPref>(seed);

  const controlled = value !== undefined;
  const current = useMemo<TableColumnPref>(() => {
    const src = controlled ? value! : local;
    return {
      hidden: mergeHiddenColumns(src.hidden, hideable),
      order: src.order.length > 0 ? mergeColumnOrder(src.order, defaults) : [],
    };
  }, [controlled, value, local, hideable, defaults]);

  const apply = useCallback(
    (next: TableColumnPref) => {
      if (!controlled) setLocal(next);
      onChange?.(next);
      queueTablePrefs({ tableKey, hidden: next.hidden, order: next.order });
    },
    [controlled, onChange, tableKey],
  );

  const onReorder = useCallback(
    (order: string[]) => apply({ hidden: current.hidden, order }),
    [apply, current.hidden],
  );

  const onToggleColumn = useCallback(
    (key: string) => {
      const set = new Set(current.hidden);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      apply({ hidden: [...set], order: current.order });
    },
    [apply, current.hidden, current.order],
  );

  const onMoveColumn = useCallback(
    (key: string, delta: number) => {
      // The order the arrows act on is the EFFECTIVE one, so a table that has
      // never been reordered still moves from where its columns actually are.
      const base = current.order.length > 0 ? current.order : [...defaults];
      apply({ hidden: current.hidden, order: moveColumn(base, key, delta) });
    },
    [apply, current.hidden, current.order, defaults],
  );

  const onResetColumns = useCallback(() => {
    const empty: TableColumnPref = { hidden: [], order: [] };
    if (!controlled) setLocal(empty);
    onChange?.(empty);
    queueTablePrefs({ tableKey, ...empty, reset: true });
  }, [controlled, onChange, tableKey]);

  return {
    hidden: current.hidden,
    order: current.order,
    tableProps: {
      columnsKey: tableKey,
      hidden: current.hidden,
      order: current.order,
      onReorder,
      onToggleColumn,
      onMoveColumn,
      onResetColumns,
      columnsDirty: current.hidden.length > 0 || current.order.length > 0,
    },
  };
}
