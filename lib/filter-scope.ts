"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ResolvedView } from "@/lib/effective-view";

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

// ── The page's RESOLVED view (2026-11-01) ────────────────────────────────────
// Range, remembered filters and Excluded resolve SERVER-side, so the address
// bar alone doesn't say what the page shows. The three shared controls that
// receive the resolved values register them here — `useFilterParams` (the
// filters), `DateRangePicker` (the range), `ExcludedToggle` (Excluded) — and
// the comment panel stores the EFFECTIVE view a comment was written under
// (lib/effective-view.ts), not the bare URL.

let resolvedView: ResolvedView = {};
const viewListeners = new Set<() => void>();
const viewStore = {
  subscribe(cb: () => void) {
    viewListeners.add(cb);
    return () => {
      viewListeners.delete(cb);
    };
  },
  get: (): ResolvedView => resolvedView,
};
const EMPTY_VIEW: ResolvedView = {};

/** The mounted page's resolved view (re-renders when a control registers). */
export function useResolvedView(): ResolvedView {
  return useSyncExternalStore(viewStore.subscribe, viewStore.get, () => EMPTY_VIEW);
}

/** The resolved view right now — for an event handler (a comment's Post). */
export function currentResolvedView(): ResolvedView {
  return resolvedView;
}

/**
 * Register one part of the page's resolved view while the control is mounted.
 * `undefined` registers nothing (a control that doesn't know the value).
 */
export function useRegisterResolvedView<K extends keyof ResolvedView>(
  part: K,
  value: ResolvedView[K] | undefined,
): void {
  const key = value === undefined ? null : JSON.stringify(value);
  useEffect(() => {
    if (key === null) return;
    const mine = JSON.parse(key) as ResolvedView[K];
    resolvedView = { ...resolvedView, [part]: mine };
    for (const l of viewListeners) l();
    return () => {
      if (resolvedView[part] !== mine) return; // a newer registration owns it
      const next = { ...resolvedView };
      delete next[part];
      resolvedView = next;
      for (const l of viewListeners) l();
    };
  }, [part, key]);
}
