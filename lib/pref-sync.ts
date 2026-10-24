"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { setIncludeExcludedPref, setPreferredRange } from "@/app/actions/user-prefs";
import { safeAction } from "@/lib/action-failure";
import { isCallFailure, toastActionFailure } from "@/lib/action-toast";
import { decodePreferredRange, todayIso, type DateRangeValue } from "@/lib/date-presets";
import { afterNavigation } from "@/lib/router-queue";

/**
 * The two `users`-row preferences a pick writes THROUGH (W2-1, 2026-10): the
 * date range and the Excluded toggle. One render per pick — the URL write the
 * control already makes — and no revalidation, the remembered filters' rule.
 *
 * WHY THIS MODULE EXISTS: the old path (`revalidatePath` + `router.refresh()`)
 * also EMPTIED the client router cache, and that was load-bearing in one case.
 * A page visited BEFORE the pick, restored by Back/Forward, comes back from
 * that cache as it was rendered — with the old default — because a popstate
 * restore never refetches. So this tab remembers what it last wrote, and a
 * control that shows the server-resolved preference (a bare URL) compares it
 * with that ON MOUNT: different → `router.refresh()`, ONCE per (URL, value),
 * so a page that resolves the preference its own way can never loop. A fresh
 * visit already matches and costs nothing. Mount only, never on a re-render:
 * right after a pick the control re-renders with the OLD props while its own
 * navigation is still pending, and checking then cost a second render.
 */

let writtenRange: string | null = null;
let writtenExcluded: boolean | null = null;
const refreshed = new Set<string>();

// The write goes AFTER the control's URL write, never before it
// (`afterNavigation`, lib/router-queue.ts): an action still pending when the
// navigation starts costs a second full render once it lands — measured, one
// pick cost the navigation plus that refresh. Both controls call these and
// navigate on the same tick, so the action queues behind the navigation.

/** Pure: does a bare page showing `shown` predate the range this tab wrote? */
export function rangeIsBehind(
  shown: DateRangeValue | undefined,
  written: string | null,
  today: string,
): boolean {
  if (!shown || written === null) return false;
  const want = decodePreferredRange(written, today);
  return want !== null && (want.from !== shown.from || want.to !== shown.to);
}

/** Pure: does a bare page showing `shown` predate the Excluded choice written? */
export function excludedIsBehind(shown: boolean, written: boolean | null): boolean {
  return written !== null && written !== shown;
}

/** Remember a picked range as this user's default. Fire-and-forget. */
export function rememberRange(value: string): void {
  const before = writtenRange;
  writtenRange = value;
  afterNavigation(() => {
    void safeAction(() => setPreferredRange(value)).then((res) => {
      if (res.ok) return;
      // Not saved: the next bare visit will (rightly) show the old default, so
      // stop expecting the new one.
      if (writtenRange === value) writtenRange = before;
      // A refusal of a best-effort write stays quiet (as it always has); a
      // broken CALL — a stale tab, no network — says so.
      if (isCallFailure(res)) toastActionFailure(res, "Couldn't remember that range.");
    });
  });
}

/** Remember the Excluded toggle as this user's default. Fire-and-forget. */
export function rememberIncludeExcluded(on: boolean): void {
  const before = writtenExcluded;
  writtenExcluded = on;
  afterNavigation(() => {
    void safeAction(() => setIncludeExcludedPref(on)).then((res) => {
      if (res.ok) return;
      if (writtenExcluded === on) writtenExcluded = before;
      if (isCallFailure(res)) toastActionFailure(res, "Couldn't remember that setting.");
    });
  });
}

/**
 * Re-read a page restored from the router cache with a preference older than
 * the one this tab wrote. `behind` is computed by the caller from what it
 * shows — and only when it shows the RESOLVED preference (no explicit URL
 * value), since an explicit value is the truth whatever the default says.
 */
export function useRefreshWhenBehind(kind: string, behind: boolean, written: unknown) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  // What the page showed when it MOUNTED — read once, by the mount effect.
  const atMount = useRef({ behind, key: `${kind}|${pathname}?${query}|${String(written)}` });
  useEffect(() => {
    const { behind: wasBehind, key } = atMount.current;
    if (!wasBehind || refreshed.has(key)) return;
    refreshed.add(key);
    router.refresh();
  }, [router]);
}

/** For a remembering date picker: `shown` is the resolved range on a bare URL. */
export function useRangeCatchUp(shown: DateRangeValue | undefined): void {
  const behind = rangeIsBehind(shown, writtenRange, todayIso());
  useRefreshWhenBehind("range", behind, writtenRange);
}

/** For the Excluded toggle: `shown` is the resolved state on a bare URL. */
export function useExcludedCatchUp(shown: boolean, explicit: boolean): void {
  const behind = !explicit && excludedIsBehind(shown, writtenExcluded);
  useRefreshWhenBehind("excluded", behind, writtenExcluded);
}
