import { useEffect, useState } from "react";

/**
 * Re-render once a minute, so "3m ago" stays true while a panel sits open
 * (2026-10-20). ONE interval per surface (a thread, the bell) — never one per
 * row. Returns the tick count, for a dependency list if a caller needs one.
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return tick;
}
