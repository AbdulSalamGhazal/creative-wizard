/**
 * Shared date-range presets + conversion helpers for every date selector.
 *
 * Bug history: the pickers used `date.toISOString().slice(0,10)` to turn a
 * calendar selection into a YYYY-MM-DD string. `toISOString()` is UTC, so for
 * a user east of UTC (KSA is UTC+3) a locally-picked midnight rolls back a day
 * (2 Jun 00:00+03 → 1 Jun 21:00Z → "...-06-01"). The calendar widget works in
 * LOCAL time, so all conversions here use local components and round-trip
 * cleanly regardless of timezone.
 *
 * ISO `YYYY-MM-DD` strings are timezone-agnostic calendar dates — the app's
 * source of truth for ranges. `null` for both ends means Lifetime (all-time).
 */

/** Local Date (midnight) → ISO calendar date. Timezone-safe. */
export function localDateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO calendar date → local Date at midnight. Matches react-day-picker. */
export function isoToLocalDate(iso: string): Date | undefined {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Today as an ISO calendar date in the viewer's local timezone. */
export function todayIso(): string {
  return localDateToIso(new Date());
}

function shiftIso(iso: string, days: number): string {
  const d = isoToLocalDate(iso) ?? new Date();
  d.setDate(d.getDate() + days);
  return localDateToIso(d);
}

function startOfMonth(iso: string): string {
  const d = isoToLocalDate(iso) ?? new Date();
  d.setDate(1);
  return localDateToIso(d);
}

function startOfQuarter(iso: string): string {
  const d = isoToLocalDate(iso) ?? new Date();
  const q = Math.floor(d.getMonth() / 3);
  d.setMonth(q * 3, 1);
  return localDateToIso(d);
}

export interface DateRangeValue {
  from: string;
  to: string;
}

/**
 * Lifetime / all-time is represented as a concrete range from a fixed floor
 * (before any possible data) to today, rather than an absent range. That lets
 * "no range in the URL" mean "use the default" while Lifetime stays an explicit,
 * shareable, persisted choice.
 */
export const LIFETIME_FLOOR = "2000-01-01";

/** Default range applied when nothing is selected: the last 7 days. */
export function defaultDateRange(): DateRangeValue {
  const preset = DATE_PRESETS.find((p) => p.key === "7");
  return preset!.range(todayIso())!;
}

/**
 * Resolve an effective range: the explicit one when both ends are set,
 * otherwise the default (last 7 days). Lifetime arrives as the concrete
 * floor→today range, so it passes through unchanged.
 */
export function resolveDefaultRange(
  from: string | null | undefined,
  to: string | null | undefined,
): DateRangeValue {
  if (from && to) return { from, to };
  return defaultDateRange();
}

export interface DatePreset {
  key: string;
  label: string;
  /** Inclusive range for the given "today", or null for Lifetime (all-time). */
  range: (today: string) => DateRangeValue | null;
}

/**
 * The canonical preset list, in display order. "Last N days" ranges END
 * YESTERDAY (today is excluded — its data is still partial), so "Last 3 days"
 * on Jun 4 is Jun 1–3. "This month"/"This quarter" are to-date and do include
 * today. Custom range is the calendar, not a preset entry.
 */
export const DATE_PRESETS: DatePreset[] = [
  { key: "yesterday", label: "Yesterday", range: (t) => ({ from: shiftIso(t, -1), to: shiftIso(t, -1) }) },
  { key: "3", label: "Last 3 days", range: (t) => ({ from: shiftIso(t, -3), to: shiftIso(t, -1) }) },
  { key: "5", label: "Last 5 days", range: (t) => ({ from: shiftIso(t, -5), to: shiftIso(t, -1) }) },
  { key: "7", label: "Last 7 days", range: (t) => ({ from: shiftIso(t, -7), to: shiftIso(t, -1) }) },
  { key: "14", label: "Last 14 days", range: (t) => ({ from: shiftIso(t, -14), to: shiftIso(t, -1) }) },
  { key: "30", label: "Last 30 days", range: (t) => ({ from: shiftIso(t, -30), to: shiftIso(t, -1) }) },
  { key: "this-month", label: "This month", range: (t) => ({ from: startOfMonth(t), to: t }) },
  {
    key: "last-month",
    label: "Last month",
    range: (t) => {
      const lastEnd = shiftIso(startOfMonth(t), -1); // last day of previous month
      return { from: startOfMonth(lastEnd), to: lastEnd };
    },
  },
  { key: "this-quarter", label: "This quarter", range: (t) => ({ from: startOfQuarter(t), to: t }) },
  {
    key: "past-quarter",
    label: "Past quarter",
    range: (t) => {
      const prevEnd = shiftIso(startOfQuarter(t), -1); // last day of previous quarter
      return { from: startOfQuarter(prevEnd), to: prevEnd };
    },
  },
  {
    key: "lifetime",
    label: "Lifetime",
    range: (t) => ({ from: LIFETIME_FLOOR, to: t }),
  },
];

/** Which preset (if any) the current range matches. Lifetime when cleared. */
export function activePresetKey(
  from: string | null,
  to: string | null,
): string | null {
  // Empty now means "use the default", not Lifetime — Lifetime is the concrete
  // floor→today range and matches in the preset loop below.
  if (!from || !to) return null;
  const today = todayIso();
  for (const p of DATE_PRESETS) {
    const r = p.range(today);
    if (r && r.from === from && r.to === to) return p.key;
  }
  return null;
}

/** Trigger label: the matched preset name, an explicit range, or Lifetime. */
export function presetLabel(from: string | null, to: string | null): string {
  const key = activePresetKey(from, to);
  if (key) return DATE_PRESETS.find((p) => p.key === key)!.label;
  if (from && to) return `${from} → ${to}`;
  return "Lifetime";
}
