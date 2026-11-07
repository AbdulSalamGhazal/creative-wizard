/**
 * Grouping for the ONE upload validation report (R-012, R-061). Both upload
 * pipelines — ads (`csv/errors.ts`, E-codes) and Store orders
 * (`store/errors.ts`, S-codes) — emit one entry PER ROW, so a 400-row export
 * whose six ad names were never registered produced ~400 near-identical lines.
 * The fix a person makes is per PROBLEM (register one name), so the report is
 * shaped like the fix: one group per (severity, code, value), with the rows it
 * covers. Pure, so both report surfaces and the tests share it.
 */

export type ReportSeverity = "FATAL" | "ERROR" | "WARNING";

/** The shape both catalogs' entries already share. */
export interface ReportEntry {
  code: string;
  severity: ReportSeverity;
  message: string;
  row?: number;
  rows?: number[];
  field?: string;
  value?: string;
}

export interface ReportGroup<E extends ReportEntry = ReportEntry> {
  key: string;
  code: string;
  severity: ReportSeverity;
  /** The problem in words, without the "Row N:" its first entry carried. */
  headline: string;
  value?: string;
  /** Every row the problem covers, ascending, de-duplicated. */
  rows: number[];
  entries: E[];
}

/** "Row 12: …" / "Rows 3, 7: …" — the per-row prefix the pipelines bake in. */
const ROW_PREFIX = /^Rows? \d[\d,\s–-]*:\s*/;

/** The message as a problem statement: the row prefix dropped, first letter up. */
export function problemHeadline(message: string): string {
  const rest = message.replace(ROW_PREFIX, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function entryRows(e: ReportEntry): number[] {
  const out: number[] = [];
  if (typeof e.row === "number") out.push(e.row);
  if (e.rows) out.push(...e.rows);
  return out;
}

const SEVERITY_ORDER: Record<ReportSeverity, number> = { FATAL: 0, ERROR: 1, WARNING: 2 };

/**
 * One group per distinct problem: entries with a `value` group by
 * (severity, code, value); entries without one by (severity, code, headline).
 * Fatals and errors come before warnings; within a severity, groups keep the
 * order their first entry appeared in (pipeline order).
 */
export function groupReport<E extends ReportEntry>(entries: E[]): ReportGroup<E>[] {
  const byKey = new Map<string, ReportGroup<E>>();
  const order: string[] = [];
  for (const e of entries) {
    const headline = problemHeadline(e.message);
    const key = `${e.severity}\u0001${e.code}\u0001${e.value ?? `\u0002${headline}`}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, code: e.code, severity: e.severity, headline, value: e.value, rows: [], entries: [] };
      byKey.set(key, g);
      order.push(key);
    }
    g.entries.push(e);
    g.rows.push(...entryRows(e));
  }
  const groups = order.map((k) => byKey.get(k)!);
  for (const g of groups) g.rows = [...new Set(g.rows)].sort((a, b) => a - b);
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => SEVERITY_ORDER[a.g.severity] - SEVERITY_ORDER[b.g.severity] || a.i - b.i)
    .map(({ g }) => g);
}

/** The distinct rows a set of entries touches. */
export function affectedRowCount(entries: ReportEntry[]): number {
  const s = new Set<number>();
  for (const e of entries) for (const r of entryRows(e)) s.add(r);
  return s.size;
}

/**
 * The rows a group covers, as one short phrase: "row 3", "3 rows (3, 7, 12)",
 * "38 rows (3, 7, 12 … +35)". Empty when the problem isn't row-bound.
 */
export function rowsPhrase(rows: number[], show = 3): string {
  if (rows.length === 0) return "";
  if (rows.length === 1) return `row ${rows[0]}`;
  const head = rows.slice(0, show).join(", ");
  const more = rows.length - show;
  return `${rows.length} rows (${head}${more > 0 ? ` … +${more}` : ""})`;
}
