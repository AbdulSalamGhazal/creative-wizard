"use client";

import { setFilterPrefs } from "@/app/actions/user-prefs";
import { isPersistableFilterKey, type FilterPrefEntry } from "@/validators/user-prefs";

/** One burst of filter changes is one write — a Clear is not eight. */
export const FILTER_PREF_DEBOUNCE_MS = 400;

/**
 * Merge a burst by KEY, last write wins — the pure half, so the batching is
 * testable without a timer or a network. Clearing sends `values: []`, which
 * the writer turns into a DELETE, and that must survive the merge: a key
 * toggled then cleared in one burst ends as the clear.
 */
export function mergePrefEntries(
  pending: readonly FilterPrefEntry[],
  incoming: readonly FilterPrefEntry[],
): FilterPrefEntry[] {
  const byKey = new Map<string, FilterPrefEntry>();
  for (const e of [...pending, ...incoming]) byKey.set(e.key, e);
  return [...byKey.values()];
}

/**
 * The keys THIS page declares as remembered — its standard defs plus the
 * tier-1 platform control. An ALLOW list on purpose: the shell's writer sees
 * every param a bar touches (Pacing rebuilds its whole query; a page may carry
 * `month`, `granularity`, `mode`, `tab`), and a view control must never be
 * mistaken for a filter. The declaration lives with the filter, and the writer
 * stays the one place that talks to the action. (The central
 * `NEVER_PERSIST_FILTER_KEYS` deny-list is separate: it is what NO page may
 * remember, even if it declares it.)
 */
let persisted: ReadonlySet<string> = new Set();
export function setPersistedKeys(keys: readonly string[]): void {
  persisted = new Set(keys);
}

/** A key is remembered when this page declares it and the app allows it. */
export function shouldPersistKey(key: string): boolean {
  return persisted.has(key) && isPersistableFilterKey(key);
}

let queued: FilterPrefEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget the remembered-filter write. Debounced per burst and never
 * awaited: remembering a filter must not block or delay the navigation the
 * user actually asked for, so a failure is a console warning and nothing else.
 */
export function queueFilterPrefs(entries: readonly FilterPrefEntry[]): void {
  const allowed = entries.filter((e) => shouldPersistKey(e.key));
  if (allowed.length === 0) return;
  queued = mergePrefEntries(queued, allowed);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const batch = queued;
    queued = [];
    timer = null;
    void setFilterPrefs({ entries: batch }).then(
      (res) => {
        if (!res?.ok) console.warn("Filter preferences were not saved.");
      },
      (err) => console.warn("Filter preferences were not saved:", err),
    );
  }, FILTER_PREF_DEBOUNCE_MS);
}
