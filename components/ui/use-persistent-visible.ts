"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * A Set of VISIBLE column keys persisted to `localStorage` under `storageKey`
 * (e.g. `cw-cols:video-diagnostics`), for local-state DataTable consumers whose
 * column visibility isn't URL/saved-view-backed.
 *
 * The server (and the first client paint) render the `defaultVisible` set — we
 * only adopt the stored set AFTER mount, so there's no hydration mismatch. The
 * default is never written back over a real stored value.
 */
export function usePersistentVisible<K extends string>(
  storageKey: string,
  defaultVisible: Iterable<K>,
): [Set<K>, Dispatch<SetStateAction<Set<K>>>] {
  const [visible, setVisible] = useState<Set<K>>(() => new Set(defaultVisible));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const keys = JSON.parse(raw) as K[];
        if (Array.isArray(keys)) setVisible(new Set(keys));
      }
    } catch {
      /* storage unavailable / malformed — keep the default */
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return; // don't clobber storage with the default pre-hydration
    try {
      localStorage.setItem(storageKey, JSON.stringify([...visible]));
    } catch {
      /* ignore */
    }
  }, [storageKey, visible, hydrated]);

  return [visible, setVisible];
}
