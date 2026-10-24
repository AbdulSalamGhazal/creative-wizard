"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The page's filter bar, as an empty state can reach it (D24, 2026-10).
 *
 * An empty table says "Try a wider date range or clear filters." and offers
 * the button that does it — but the table and the bar are siblings, not
 * parent and child. So the bar (FilterShell, FilterStrip) REGISTERS its own
 * Clear here while it is mounted, and the empty state's "Clear filters"
 * button calls exactly that: the same tier-2-only semantics, the same
 * write-through that deletes remembered filters, one navigation. With
 * nothing to clear the button doesn't render.
 */
export interface FilterScope {
  /** The bar's own Clear (tier-2 filters only). */
  clear: () => void;
  /** Whether any tier-2 filter is on. */
  active: boolean;
}

let current: FilterScope | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

const store = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  get: (): FilterScope | null => current,
};

/** The mounted bar's Clear, or null when the page has no filter bar. */
export function useFilterScope(): FilterScope | null {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

/** Called by a filter bar on every render: keep the registered scope current. */
export function useRegisterFilterScope(clear: () => void, active: boolean): void {
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    const scope: FilterScope = { clear: () => clearRef.current(), active };
    current = scope;
    emit();
    return () => {
      if (current === scope) {
        current = null;
        emit();
      }
    };
  }, [active]);
}
