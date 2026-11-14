"use client";

import { useEffect, useState } from "react";
import { queueFilterPrefs, setPersistedKeys } from "@/lib/filter-prefs";

/**
 * A page-level VIEW control (Board | Table, Calendar | Bars | Table …) that is
 * remembered per user per brand without living in the URL: the server resolves
 * the saved value into `initial`, a change flips local state at once (no
 * navigation, no re-render of the route) and is written through the house
 * preference queue. The default DELETES the preference, like every remembered
 * control. For pages with no FilterShell — a page that has one declares these
 * keys in its `persistKeys` instead.
 */
export function useRememberedViews<K extends string>(
  initial: Record<K, string>,
  defaults: Record<K, string>,
): [Record<K, string>, (key: K, value: string) => void] {
  const [views, setViews] = useState(initial);
  const keys = Object.keys(defaults).join(",");
  useEffect(() => {
    setPersistedKeys(keys.split(","));
  }, [keys]);
  const set = (key: K, value: string) => {
    setViews((v) => ({ ...v, [key]: value }));
    queueFilterPrefs([{ key, values: value === defaults[key] ? [] : [value] }]);
  };
  return [views, set];
}
