/**
 * Daily-series gap filling. Every daily query GROUPs BY `performance_records.
 * date`, so a day with no rows is simply absent — a chart drawn from those rows
 * silently connects the day before a pause to the day after (no zero dip) and
 * compresses the time axis. `fillDailyGaps` inserts the missing days at the
 * query layer with the decided semantics:
 *
 *  - INTERIOR gaps only: days strictly between a series' first and last data
 *    day. Nothing is invented before launch or after the latest upload.
 *  - Additive metrics (spend, impressions, …) fill with 0 — a real "nothing
 *    happened that day".
 *  - Ratio metrics (ctr, roas, …) fill with null — the ratio is undefined on a
 *    zero-denominator day, and the line must BREAK there (no `connectNulls`),
 *    because a fake 0% is a different lie than a gap.
 *
 * Dates are `YYYY-MM-DD` strings iterated in UTC (the house idiom — see
 * `isoMinusDays` in lib/creative-status.ts). No locale `new Date()` traps.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day after an ISO date, in UTC. */
function isoNextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface FillDailyGapsOptions<T> {
  /** The `YYYY-MM-DD` field name. */
  dateKey: keyof T & string;
  /** Metric fields filled with 0 on inserted days. */
  additiveKeys: ReadonlyArray<keyof T & string>;
  /** Metric fields filled with null on inserted days (line breaks there). */
  ratioKeys?: ReadonlyArray<keyof T & string>;
  /**
   * Multi-series input (per-platform / per-creative rows): fill each group
   * independently over its OWN first→last span. Identity fields on inserted
   * rows are copied from the group's first row (constant within a group).
   */
  groupKey?: keyof T & string;
}

// Hard ceiling on inserted days per gap (≈100 years) — a malformed date could
// otherwise loop forever; real windows are a few years at most.
const MAX_FILL = 36_600;

export function fillDailyGaps<T extends Record<string, unknown>>(
  rows: T[],
  { dateKey, additiveKeys, ratioKeys = [], groupKey }: FillDailyGapsOptions<T>,
): T[] {
  if (rows.length < 2) return rows;

  // Bucket into series (one pseudo-group when the data is a single series).
  const groups = new Map<unknown, T[]>();
  for (const r of rows) {
    const g = groupKey ? r[groupKey] : "";
    const arr = groups.get(g);
    if (arr) arr.push(r);
    else groups.set(g, [r]);
  }

  const out: T[] = [];
  for (const arr of groups.values()) {
    const sorted = [...arr].sort((a, b) =>
      String(a[dateKey]) < String(b[dateKey]) ? -1 : 1,
    );
    const template = sorted[0]!;
    let prev: string | null = null;
    for (const row of sorted) {
      const date = String(row[dateKey]);
      if (prev !== null && ISO_DAY.test(prev) && ISO_DAY.test(date)) {
        let cur = isoNextDay(prev);
        let guard = 0;
        while (cur < date && guard++ < MAX_FILL) {
          const filled = { ...template } as Record<string, unknown>;
          filled[dateKey] = cur;
          for (const k of additiveKeys) filled[k] = 0;
          for (const k of ratioKeys) filled[k] = null;
          out.push(filled as T);
          cur = isoNextDay(cur);
        }
      }
      out.push(row);
      prev = date;
    }
  }

  // Ascending by date across all groups — the order every pivot/chart consumer
  // expects. (A DESC consumer reverses after filling.)
  return out.sort((a, b) => {
    const da = String(a[dateKey]);
    const db = String(b[dateKey]);
    return da < db ? -1 : da > db ? 1 : 0;
  });
}
