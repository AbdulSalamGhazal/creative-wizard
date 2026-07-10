/**
 * Daily-series gap filling. Every daily query GROUPs BY `performance_records.
 * date`, so a day with no rows is simply absent — a chart drawn from those rows
 * silently connects the day before a pause to the day after (no zero dip) and
 * compresses the time axis. `fillDailyGaps` inserts the missing days:
 *
 *  - INTERIOR gaps (default): days strictly between a series' first and last
 *    data day.
 *  - EDGE gaps (opt-in via `fillFrom` / `fillTo`): leading zeros from `fillFrom`
 *    up to the series' first day, and trailing zeros from the series' last day
 *    up to `fillTo`. Callers pass `fillFrom = max(requested from, entity
 *    first-ever day)` and `fillTo = min(requested to, DATA HORIZON)` so a
 *    currently-paused entity shows zeros up to the latest upload, but nothing is
 *    invented before it launched or after the newest data (unknown ≠ zero).
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

/** A fill bound: a fixed date, or a function of the group value (multi-series). */
type Bound =
  | string
  | null
  | undefined
  | ((group: unknown) => string | null | undefined);

function resolveBound(spec: Bound, group: unknown): string | null {
  const v = typeof spec === "function" ? spec(group) : spec;
  return v && ISO_DAY.test(v) ? v : null;
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
   * independently over its OWN span. Identity fields on inserted rows are
   * copied from the group's first row (constant within a group).
   */
  groupKey?: keyof T & string;
  /**
   * Leading-edge start (inclusive): fill zeros from here up to the series' first
   * data day. A string applies uniformly; a function resolves per group value
   * (e.g. per-platform first-ever). Omit for interior-only fill.
   */
  fillFrom?: Bound;
  /**
   * Trailing-edge end (inclusive): fill zeros from the series' last data day up
   * to here. String → uniform; function → per group value (e.g. per-platform
   * horizon). Omit for interior-only fill.
   */
  fillTo?: Bound;
}

// Hard ceiling on inserted days per span (≈100 years) — a malformed date could
// otherwise loop forever; real windows are a few years at most.
const MAX_FILL = 36_600;

export function fillDailyGaps<T extends Record<string, unknown>>(
  rows: T[],
  {
    dateKey,
    additiveKeys,
    ratioKeys = [],
    groupKey,
    fillFrom,
    fillTo,
  }: FillDailyGapsOptions<T>,
): T[] {
  const hasEdges = fillFrom !== undefined || fillTo !== undefined;
  if (rows.length === 0) return rows;
  if (rows.length < 2 && !hasEdges) return rows;

  // Bucket into series (one pseudo-group when the data is a single series).
  const groups = new Map<unknown, T[]>();
  for (const r of rows) {
    const g = groupKey ? r[groupKey] : "";
    const arr = groups.get(g);
    if (arr) arr.push(r);
    else groups.set(g, [r]);
  }

  const out: T[] = [];
  for (const [groupValue, arr] of groups) {
    const sorted = [...arr].sort((a, b) =>
      String(a[dateKey]) < String(b[dateKey]) ? -1 : 1,
    );
    const template = sorted[0]!;
    const makeFilled = (date: string): T => {
      const filled = { ...template } as Record<string, unknown>;
      filled[dateKey] = date;
      for (const k of additiveKeys) filled[k] = 0;
      for (const k of ratioKeys) filled[k] = null;
      return filled as T;
    };

    const firstDate = String(sorted[0]![dateKey]);
    const lastDate = String(sorted[sorted.length - 1]![dateKey]);

    // Leading edge: fillFrom .. firstDate (exclusive of firstDate).
    const from = resolveBound(fillFrom, groupValue);
    if (from && ISO_DAY.test(firstDate) && from < firstDate) {
      let cur = from;
      let guard = 0;
      while (cur < firstDate && guard++ < MAX_FILL) {
        out.push(makeFilled(cur));
        cur = isoNextDay(cur);
      }
    }

    // Interior gaps + the real rows.
    let prev: string | null = null;
    for (const row of sorted) {
      const date = String(row[dateKey]);
      if (prev !== null && ISO_DAY.test(prev) && ISO_DAY.test(date)) {
        let cur = isoNextDay(prev);
        let guard = 0;
        while (cur < date && guard++ < MAX_FILL) {
          out.push(makeFilled(cur));
          cur = isoNextDay(cur);
        }
      }
      out.push(row);
      prev = date;
    }

    // Trailing edge: lastDate (exclusive) .. fillTo (inclusive).
    const to = resolveBound(fillTo, groupValue);
    if (to && ISO_DAY.test(lastDate) && to > lastDate) {
      let cur = isoNextDay(lastDate);
      let guard = 0;
      while (cur <= to && guard++ < MAX_FILL) {
        out.push(makeFilled(cur));
        cur = isoNextDay(cur);
      }
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

/**
 * Aggregate multi-series daily points into ONE group line over the full axis,
 * gap- and edge-filled — the rotation-safe pivot the campaign / dashboard /
 * creative "grouped" mode uses. Extracted here (out of the charts' useMemos) so
 * the rotation + edge behaviour is unit-testable:
 *
 *  - A campaign-wide pause that falls BETWEEN creatives' spans (rotation) still
 *    produces a continuous axis with a real 0 dip, because we pivot to one
 *    value per day over the UNION of all series before filling.
 *  - `additive` picks the fill: sum metrics dip to 0, ratios break (null).
 *  - `fillFrom` / `fillTo` add the leading / trailing edge zeros for a currently
 *    -paused or late-starting entity (see fillDailyGaps).
 */
export function fillGroupSeries<T extends Record<string, unknown>>(
  points: T[],
  opts: {
    dateKey: keyof T & string;
    /** Aggregate one day's points into the group value (sum / weighted ratio). */
    aggregate: (dayPoints: T[]) => number | null;
    additive: boolean;
    fillFrom?: string | null;
    fillTo?: string | null;
  },
): Array<{ date: string; all: number | null }> {
  const byDate = new Map<string, T[]>();
  for (const p of points) {
    const d = String(p[opts.dateKey]);
    const arr = byDate.get(d);
    if (arr) arr.push(p);
    else byDate.set(d, [p]);
  }
  const rows = [...byDate.keys()]
    .sort()
    .map((date) => ({ date, all: opts.aggregate(byDate.get(date)!) }));

  return fillDailyGaps(rows, {
    dateKey: "date",
    additiveKeys: opts.additive ? ["all"] : [],
    ratioKeys: opts.additive ? [] : ["all"],
    fillFrom: opts.fillFrom ?? undefined,
    fillTo: opts.fillTo ?? undefined,
  });
}
