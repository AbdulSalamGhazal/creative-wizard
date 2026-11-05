"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-viewer VIEW toggles of the Price Structure pages (brief §4.3): the
 * Overview's grouping, cost view and chart metric; the Plan page's mode,
 * period grain, selected period and mix grouping. Display conveniences that
 * nobody needs on another device — the same class as Budget's USD/SAR toggle
 * — so they live in this browser, under one key prefix, in ONE file (the
 * `lib/browser-storage.test.ts` census names it).
 *
 * Read after mount so the server render and the first client render agree;
 * every access is guarded (private windows, blocked storage).
 */
const PREFIX = "cw:ps:";

export function useViewPref<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null && (!allowed || (allowed as readonly string[]).includes(raw))) setValue(raw as T);
    } catch {
      /* ignore */
    }
    // `allowed` is a constant list per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(PREFIX + key, next);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set];
}
