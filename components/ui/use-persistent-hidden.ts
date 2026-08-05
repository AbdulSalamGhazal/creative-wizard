"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * A Set of HIDDEN column keys persisted to `localStorage` under `storageKey`.
 * The sibling of `usePersistentVisible`, but inverted: it stores what the user
 * has CHOSEN TO HIDE rather than what's visible. That inversion matters when the
 * column set can GROW at runtime (e.g. an admin adds a Store custom field): a
 * key that isn't in the stored hidden set is visible, so a brand-new column
 * shows up automatically until the viewer hides it — a visible-set would have
 * defaulted new columns to hidden.
 *
 * Like the visible variant, we render the empty default on the server + first
 * paint and only adopt the stored set after mount (no hydration mismatch), and
 * never write the default back over a real stored value.
 */
export function usePersistentHidden<K extends string>(
  storageKey: string,
): [Set<K>, Dispatch<SetStateAction<Set<K>>>] {
  const [hidden, setHidden] = useState<Set<K>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const keys = JSON.parse(raw) as K[];
        if (Array.isArray(keys)) setHidden(new Set(keys));
      }
    } catch {
      /* storage unavailable / malformed — keep the default (nothing hidden) */
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return; // don't clobber storage with the default pre-hydration
    try {
      localStorage.setItem(storageKey, JSON.stringify([...hidden]));
    } catch {
      /* ignore */
    }
  }, [storageKey, hidden, hydrated]);

  return [hidden, setHidden];
}
