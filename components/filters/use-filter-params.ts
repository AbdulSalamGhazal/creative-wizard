"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavTransition } from "@/lib/nav-progress";
import { queueFilterPrefs } from "@/lib/filter-prefs";
import { FILTERS_EXPLICIT_PARAM, type FilterPrefEntry } from "@/validators/user-prefs";

/**
 * The URL-param writer every FilterShell page uses. Same behaviour the filter
 * bars always had — replace, keep scroll, drop empty keys, drive the nav
 * progress bar through `useNavTransition` — plus ONE thing they didn't have:
 *
 * **writes in the same tick COMPOSE.** Each `update` used to start from the
 * render's `searchParams` snapshot, so two writes before the navigation landed
 * both built on the OLD params and the last one silently undid the first. That
 * is fine while every control writes once, and broken the moment something
 * writes N times at once — "Clear filters" clears each declared filter in turn,
 * and only the last one survived. Batching through a ref makes Clear one
 * navigation, and also stops two fast checkbox clicks from eating each other.
 *
 * It is also the WRITE-THROUGH point for remembered filters (2026-09): every
 * change it writes is diffed against the params it started from, and each
 * changed key is queued as a preference — a set upserts, a cleared one
 * DELETES. Diffing the URL rather than the handler's argument is deliberate:
 * a filter whose param isn't a plain join of its values (Ads' `rate`, which
 * carries its scope: `total:good`) is then remembered exactly as the URL
 * holds it, so resolution can hand the string straight back.
 *
 * `resolved` is the server's answer for THIS render (URL → preference → page
 * default). It is the baseline for both halves of the honesty rule:
 *  · `get(key)` — what the bar shows, so a chip appears for a remembered
 *    filter even though the URL is bare (the range picker's `fallback`, for
 *    filters);
 *  · the diff — removing that chip writes nothing new to the URL (the param
 *    was never there), so without the baseline the preference would survive
 *    its own removal and resurrect on the next visit.
 */
/**
 * The keys whose param value CHANGED between two query strings, with the new
 * value's parts — the write-through's payload. Pure, so the diff is testable.
 */
export function changedFilterEntries(before: string, after: string): FilterPrefEntry[] {
  const a = new URLSearchParams(before);
  const b = new URLSearchParams(after);
  const out: FilterPrefEntry[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const prev = a.get(key) ?? "";
    const next = b.get(key) ?? "";
    if (prev === next) continue;
    out.push({ key, values: next ? next.split(",").filter(Boolean) : [] });
  }
  return out;
}

/**
 * The composition itself, pure so it can be tested: mutate the params we last
 * WROTE if that write hasn't landed yet, otherwise the current ones, and drop
 * empty keys. Returns the next query string.
 */
export function nextQueryString(
  current: string,
  pending: string | null,
  mutate: (next: URLSearchParams) => void,
): string {
  const next = new URLSearchParams(pending ?? current);
  mutate(next);
  // Drop empty keys for a clean URL.
  for (const [key, value] of [...next.entries()]) {
    if (!value) next.delete(key);
  }
  return next.toString();
}

/**
 * The query string as the USER sees it: the URL, plus every resolved value the
 * URL doesn't carry. Pure, so the honesty rule is testable.
 */
export function effectiveQueryString(
  current: string,
  resolved?: Record<string, string | undefined>,
): string {
  if (!resolved) return current;
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(resolved)) {
    if (value && !params.has(key)) params.set(key, value);
  }
  return params.toString();
}

export function useFilterParams(resolved?: Record<string, string | undefined>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();
  /** The query string we last wrote, until the router hands it back to us. */
  const pending = useRef<string | null>(null);
  /** A stable dep for the resolved record (a fresh object every render). */
  const resolvedKey = resolved ? JSON.stringify(resolved) : "";

  useEffect(() => {
    // The write landed (or something else navigated) — start fresh.
    pending.current = null;
  }, [searchParams]);

  /**
   * A filter's EFFECTIVE value: the URL wins, else the remembered value the
   * server resolved for this render. Bars read their own params through this so
   * the chips describe what actually ran.
   */
  const get = useCallback(
    (key: string): string | null =>
      searchParams.get(key) ??
      // Once the URL states its filters in full, it is the only truth — so a
      // filter the user just removed doesn't flash back while the server
      // re-renders.
      (searchParams.has(FILTERS_EXPLICIT_PARAM) ? null : (resolved?.[key] ?? null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, resolvedKey],
  );

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      // Both the write and the diff start from what the user SEES: the URL,
      // plus the preferences resolved into it. A remembered filter becomes
      // explicit in the URL the moment any filter is touched (the link stays
      // shareable), and removing a remembered value is then a real change to
      // diff against — it was never a param to begin with.
      const before =
        pending.current ?? effectiveQueryString(searchParams.toString(), resolved);
      const qs = nextQueryString(before, null, (next) => {
        mutate(next);
        // "This URL states its filters in full" — set once the user touches a
        // filter on a page that has remembered ones, so the server stops
        // resolving preferences on top of it and a cleared filter STAYS clear
        // (the write-through that deletes it is deliberately not awaited).
        if (resolved) next.set(FILTERS_EXPLICIT_PARAM, "1");
      });
      pending.current = qs;
      // Fire-and-forget — never awaited, never in the navigation's way.
      queueFilterPrefs(changedFilterEntries(before, qs));
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, router, searchParams, resolvedKey],
  );

  return { searchParams, update, get };
}
