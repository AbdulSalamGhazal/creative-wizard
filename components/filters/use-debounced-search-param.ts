"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A search box's debounced URL param — ONE implementation for every bar
 * (Ads, Library, Campaigns, Store orders; R-056).
 *
 * The input is the source of truth while the user types; the URL is a
 * debounced side effect. Two rules keep the two honest:
 *  · our OWN writes are recorded, so when a navigation lands a few keystrokes
 *    late its echo is ignored and can't reset the field and eat the
 *    characters typed since;
 *  · a change we DIDN'T originate (Clear, a saved view, Back/Forward) is
 *    adopted, so the box never shows text the results no longer match.
 * The TRIMMED input is compared with the URL so a trailing space doesn't loop
 * a no-op write.
 *
 * `urlValue` is the param as the URL holds it now; `write` receives the
 * trimmed value ("" = delete the param) and performs the URL write.
 */
export function useDebouncedSearchParam(
  urlValue: string,
  write: (trimmed: string) => void,
  delay = 250,
): [string, (next: string) => void] {
  const [input, setInput] = useState(urlValue);
  const pendingPushes = useRef<Set<string>>(new Set());
  // The latest writer, so a fresh closure every render doesn't restart the
  // debounce timer.
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  });

  useEffect(() => {
    if (pendingPushes.current.has(urlValue)) {
      // Our own debounced write echoing back — keep what was typed since.
      pendingPushes.current.delete(urlValue);
      return;
    }
    // A genuine external change → adopt it and drop our now-stale writes.
    pendingPushes.current.clear();
    setInput(urlValue);
  }, [urlValue]);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === urlValue) return;
    const id = setTimeout(() => {
      // Record before navigating so the echo above is recognised as ours.
      pendingPushes.current.add(trimmed);
      writeRef.current(trimmed);
    }, delay);
    return () => clearTimeout(id);
  }, [input, urlValue, delay]);

  return [input, setInput];
}
