"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queueTablePrefs, resetTablePrefsNow } from "@/lib/table-prefs";
import { useTablePref } from "@/components/ui/table-prefs-context";
import {
  isDefaultColumnState,
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
  defaultHidden = [],
  initial,
  value,
  onChange,
}: {
  tableKey: TableKey;
  /** Column keys that MAY be hidden (everything but the pinned one). */
  hideable: readonly string[];
  /** The non-pinned column keys in config order. */
  defaults: readonly string[];
  /**
   * Columns hidden on a FIRST visit — the table's own default. Several tables
   * ship with a long metric tail collapsed; with one of these set, "nothing
   * hidden" is a real choice and is stored, while matching this set is the
   * default and deletes the row.
   */
  defaultHidden?: readonly string[];
  /**
   * The server-resolved preference. OPTIONAL since phase 2: the dashboard
   * layout provides every table's preference through context, so a table only
   * passes this when it has a more specific source.
   */
  initial?: TableColumnPref;
  /** The current value, for the URL-backed shape. Presence = controlled. */
  value?: TableColumnPref;
  /** Where a change goes besides the preference (the URL writer). */
  onChange?: (next: TableColumnPref) => void;
}): UseTableColumnsResult {
  const fromContext = useTablePref(tableKey);
  const source = initial ?? fromContext;
  // No stored preference → the table's own first-visit default.
  const hasPref = source.hidden.length > 0 || source.order.length > 0;
  const seed = useMemo<TableColumnPref>(
    () => ({
      hidden: mergeHiddenColumns(hasPref ? source.hidden : defaultHidden, hideable),
      order: source.order.length ? mergeColumnOrder(source.order, defaults) : [],
    }),
    // The seed is exactly that — later server values arrive through `value`
    // (controlled) or not at all, so re-seeding on every render would fight the
    // user's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableKey],
  );
  const [local, setLocal] = useState<TableColumnPref>(seed);

  const controlled = value !== undefined;

  /**
   * OPTIMISTIC, controlled shape only. A URL-backed table's `value` arrives
   * from the server, so between a click and the navigation landing the open
   * popover would keep showing the OLD columns — most visibly after Reset,
   * which also waits for its delete first. Holding the new value here makes the
   * control answer instantly; the effect below drops it the moment the real
   * value catches up, so the server stays the source of truth.
   */
  const [optimistic, setOptimistic] = useState<TableColumnPref | null>(null);
  const valueKey = controlled ? JSON.stringify(value) : "";
  const lastValueKey = useRef(valueKey);
  useEffect(() => {
    if (valueKey === lastValueKey.current) return;
    lastValueKey.current = valueKey;
    setOptimistic(null);
  }, [valueKey]);

  const current = useMemo<TableColumnPref>(() => {
    const src = controlled ? (optimistic ?? value!) : local;
    return {
      hidden: mergeHiddenColumns(src.hidden, hideable),
      order: src.order.length > 0 ? mergeColumnOrder(src.order, defaults) : [],
    };
  }, [controlled, value, optimistic, local, hideable, defaults]);

  const apply = useCallback(
    (next: TableColumnPref) => {
      if (controlled) setOptimistic(next);
      else setLocal(next);
      onChange?.(next);
      // Back at the table's own default? Then there is nothing to remember —
      // DELETE the row rather than store a "no opinion" that would outlive the
      // next column change. (With a non-empty `defaultHidden`, an EMPTY hidden
      // set is NOT the default and is stored.)
      if (isDefaultColumnState(next, defaultHidden)) void resetTablePrefsNow(tableKey);
      else queueTablePrefs({ tableKey, hidden: next.hidden, order: next.order });
    },
    [controlled, onChange, tableKey, defaultHidden],
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

  /**
   * Reset is the one path that WAITS for its write.
   *
   * On a URL-backed table the reset strips `hide`/`order` from the URL, and a
   * bare URL reads as "no opinion" — so the server falls through to the
   * preference. With the delete still in the debounce, the row the user just
   * reset is re-applied by the very next render and the control looks broken
   * (it did, on /campaigns). So: drop any queued write for this table, delete
   * the row, THEN navigate. A deliberate click can afford the round-trip.
   *
   * The local shape has no such race — its own state wins immediately — but it
   * goes through the same call so a pending toggle can't recreate the row.
   */
  const onResetColumns = useCallback(() => {
    // "Default" is the table's own first-visit state, not necessarily nothing.
    const empty: TableColumnPref = { hidden: [...defaultHidden], order: [] };
    if (!controlled) {
      setLocal(empty);
      void resetTablePrefsNow(tableKey);
      return;
    }
    // The control snaps to defaults NOW; the delete and the navigation follow.
    setOptimistic(empty);
    void resetTablePrefsNow(tableKey).then(() => onChange?.(empty));
  }, [controlled, onChange, tableKey, defaultHidden]);

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
      // "Dirty" means AWAY FROM THE TABLE'S DEFAULT, which is not the same as
      // "something is hidden" once a table ships with a collapsed tail.
      columnsDirty: !isDefaultColumnState(current, defaultHidden),
    },
  };
}
