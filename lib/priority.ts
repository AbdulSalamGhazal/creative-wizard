/**
 * PRIORITY — the team's manual judgment of a creative's importance: 1..3
 * (3 = highest), `null` = unrated. A real default state, never a numeric 0 and
 * never auto-set.
 *
 * Deliberately DISTINCT from the computed performance concept ("Rate", see
 * lib/rating.ts): Rate = computed performance, Priority = manual judgment. The
 * word "rating" must never name this feature, and "stars" is only the UI
 * metaphor — it appears nowhere in the schema or the code.
 */

/** Filter tokens, as they travel in the URL. "unrated" is a first-class choice. */
export const PRIORITY_FILTER_VALUES = ["3", "2", "1", "unrated"] as const;
export type PriorityFilterValue = (typeof PRIORITY_FILTER_VALUES)[number];

export const PRIORITY_FILTER_LABEL: Record<PriorityFilterValue, string> = {
  "3": "3 — highest",
  "2": "2",
  "1": "1",
  unrated: "Unrated",
};

/** Split the filter tokens into the numeric set and the "unrated" flag. */
export function splitPriorityFilter(
  values: readonly string[],
): { numbers: number[]; unrated: boolean } {
  const numbers: number[] = [];
  let unrated = false;
  for (const v of values) {
    if (v === "unrated") unrated = true;
    else {
      const n = Number(v);
      if (n === 1 || n === 2 || n === 3) numbers.push(n);
    }
  }
  return { numbers: [...new Set(numbers)].sort((a, b) => b - a), unrated };
}

/**
 * Sort comparator for Priority: rated creatives first in the chosen direction,
 * UNRATED ALWAYS LAST — in both directions.
 *
 * Unrated is an absence of judgment, not a low one: floating it to the top on
 * an ascending sort would read as "these are the least important", which is
 * exactly what nobody said. `dir` is 1 for ascending (1 → 3), -1 for descending.
 */
export function comparePriority(
  a: number | null,
  b: number | null,
  dir: 1 | -1,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const d = (a - b) * dir;
  // Normalize -0 (which `(2 - 2) * -1` produces) so callers comparing against
  // 0 with Object.is see a plain zero.
  return d === 0 ? 0 : d;
}
