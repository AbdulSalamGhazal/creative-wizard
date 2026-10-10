"use client";

import { createContext, useContext } from "react";
import { EMPTY_TABLE_PREF, type TableColumnPref } from "@/lib/table-columns";

/**
 * Every table's remembered columns for this user and brand, read ONCE in the
 * dashboard layout and handed to the client (phase 2, 2026-10).
 *
 * WHY A PROVIDER rather than a prop per page: there are fifteen tables across
 * a dozen routes, several of them nested two or three components deep. Threading
 * an `initial` prop to each would be a dozen server-page edits — the exact
 * surface the RSC rule says to be careful with — for data that is ONE
 * `cache()`-deduped row set. With the provider a new table needs no page change
 * at all: it passes its `columnsKey` and reads its own preference.
 *
 * The explicit `initial` prop on `useTableColumns` still wins where a caller has
 * one (phase 1's three pages pass it), so nothing had to be rewritten.
 */
const TablePrefsContext = createContext<Record<string, TableColumnPref>>({});

export function TablePrefsProvider({
  prefs,
  children,
}: {
  prefs: Record<string, TableColumnPref>;
  children: React.ReactNode;
}) {
  return (
    <TablePrefsContext.Provider value={prefs}>{children}</TablePrefsContext.Provider>
  );
}

/** One table's remembered columns. The EMPTY pref when it has none. */
export function useTablePref(tableKey: string): TableColumnPref {
  return useContext(TablePrefsContext)[tableKey] ?? EMPTY_TABLE_PREF;
}
