/** Riyadh is UTC+3 all year (no daylight saving). */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Today's date in Riyadh, `YYYY-MM-DD` — the day Store orders are filed under. */
export function riyadhToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

/** An instant's Riyadh time of day, 24-hour `HH:MM` — how Store shows when an order was placed. */
export function riyadhClock(at: Date): string {
  return new Date(at.getTime() + RIYADH_OFFSET_MS).toISOString().slice(11, 16);
}
