"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavTransition } from "@/lib/nav-progress";

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
 */
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

export function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();
  /** The query string we last wrote, until the router hands it back to us. */
  const pending = useRef<string | null>(null);

  useEffect(() => {
    // The write landed (or something else navigated) — start fresh.
    pending.current = null;
  }, [searchParams]);

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const qs = nextQueryString(searchParams.toString(), pending.current, mutate);
      pending.current = qs;
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, router, searchParams],
  );

  return { searchParams, update };
}
