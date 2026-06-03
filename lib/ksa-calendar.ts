/**
 * KSA calendar events for timeline annotations — computed, never hardcoded.
 *
 * Ramadan / Eid dates are derived live from the Umm al-Qura (Islamic) calendar
 * via `Intl.DateTimeFormat`, so they stay correct every year without a lookup
 * table. Payday is the KSA-typical 27th-of-month government salary date.
 *
 * Dates are ISO `YYYY-MM-DD` (UTC). The caller decides how to draw them.
 */

export type KsaEventType = "ramadan" | "eid-fitr" | "eid-adha" | "payday";

export interface CalendarEvent {
  date: string;
  label: string;
  type: KsaEventType;
}

/** Hijri (Umm al-Qura) year/month/day for an ISO date. */
function hijriParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), day: get("day") };
}

/**
 * KSA calendar events within an inclusive ISO range. Iterates day-by-day
 * (capped) and flags the first day of Ramadan (Hijri 9/1), Eid al-Fitr
 * (10/1), Eid al-Adha (12/10), and the 27th-of-month payday.
 */
export function ksaCalendarEvents(from: string, to: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  if (end < start) return out;

  const MAX_DAYS = 800; // guard against pathological ranges
  let count = 0;
  for (
    const d = new Date(start);
    d <= end && count < MAX_DAYS;
    d.setUTCDate(d.getUTCDate() + 1), count++
  ) {
    const iso = d.toISOString().slice(0, 10);
    const h = hijriParts(d);
    if (h.m === 9 && h.day === 1) {
      out.push({ date: iso, label: "Ramadan begins", type: "ramadan" });
    } else if (h.m === 10 && h.day === 1) {
      out.push({ date: iso, label: "Eid al-Fitr", type: "eid-fitr" });
    } else if (h.m === 12 && h.day === 10) {
      out.push({ date: iso, label: "Eid al-Adha", type: "eid-adha" });
    }
    if (d.getUTCDate() === 27) {
      out.push({ date: iso, label: "Payday", type: "payday" });
    }
  }
  return out;
}

export const KSA_EVENT_COLOR: Record<KsaEventType, string> = {
  ramadan: "#a78bfa", // violet
  "eid-fitr": "#34d399", // emerald
  "eid-adha": "#34d399",
  payday: "#fbbf24", // amber
};
