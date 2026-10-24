/**
 * Row-value coercions shared by the query modules (W3-7: `numOrNull` was
 * defined in five of them). Postgres `numeric` and aggregate results arrive as
 * strings; NULL must stay NULL — a dash, never a fabricated 0.
 */
export const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
