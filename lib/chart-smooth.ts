/**
 * Centered moving average for the named numeric columns of a pivoted chart
 * dataset (one row per date, one column per series). Each point becomes the
 * mean of the non-null values within ±half; null stays null (a gap, not
 * invented) so `connectNulls` still bridges missing days the same way.
 *
 * Shared by every line chart's "Smooth" toggle so the smoothing is identical.
 */
const DEFAULT_HALF = 3; // ±3 → a 7-day window

export function smoothColumns<T extends Record<string, unknown>>(
  rows: T[],
  keys: string[],
  half = DEFAULT_HALF,
): T[] {
  if (rows.length === 0) return rows;
  const cols = new Map<string, Array<number | null>>();
  for (const key of keys) {
    cols.set(
      key,
      rows.map((row, i) => {
        if (typeof row[key] !== "number") return null;
        let sum = 0;
        let n = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(rows.length - 1, i + half); j++) {
          const v = rows[j]?.[key];
          if (typeof v === "number") {
            sum += v;
            n += 1;
          }
        }
        return n > 0 ? sum / n : null;
      }),
    );
  }
  return rows.map((row, i) => {
    const next = { ...row } as Record<string, unknown>;
    for (const key of keys) next[key] = cols.get(key)![i];
    return next as T;
  });
}
