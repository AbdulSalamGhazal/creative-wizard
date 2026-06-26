"use client";

import { useEffect, useTransition, type TransitionStartFunction } from "react";

/**
 * Global navigation-progress signal.
 *
 * Same-route filter / date changes navigate via `useTransition`, which (by
 * design) keeps the current page visible while the server re-renders — with NO
 * built-in spinner. That reads as "nothing happened" on a slow query. We surface
 * those pending states into one tiny store so a top loading bar can show across
 * the whole app. A counter handles concurrent transitions from different
 * components (e.g. two filters changed at once).
 */
let active = 0;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export const navProgress = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  /** Snapshot for useSyncExternalStore — true while any nav transition pends. */
  isActive(): boolean {
    return active > 0;
  },
  begin() {
    active += 1;
    emit();
  },
  end() {
    active = Math.max(0, active - 1);
    emit();
  },
};

/**
 * Drop-in replacement for React's `useTransition` that also reports its pending
 * state to the global nav bar. Use it for any transition that drives a
 * route/searchParam change, so the user sees a loading indicator while the
 * server re-renders. Same return shape as `useTransition`.
 */
export function useNavTransition(): [boolean, TransitionStartFunction] {
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!pending) return;
    navProgress.begin();
    return () => navProgress.end();
  }, [pending]);
  return [pending, start];
}
