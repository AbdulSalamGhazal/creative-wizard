/**
 * Tiny client-side CSV writer + browser download trigger.
 *
 * Used by the "Download CSV" buttons across the dashboard. Stays in the
 * client so we don't round-trip through the server for what's already
 * rendered.
 */

export interface CsvColumn<T> {
  key: string;
  label: string;
  /** Cell value getter. Return `null`/`undefined` for empty. */
  value: (row: T, index: number) => string | number | null | undefined;
}

/** A cell a spreadsheet would evaluate: it starts with = + - @ (or tab / CR). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** …unless it is just a number written as text ("-12.50" is a number). */
const PLAIN_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Neutralize spreadsheet formulas in TEXT cells (D4, 2026-10-23): a text cell
 * starting with = + - @ (or a tab / carriage return) gains a leading
 * apostrophe, so Excel or Sheets shows it as text instead of evaluating it.
 * Store order exports carry customer-typed text (names, addresses) and ad
 * names come from platform exports, so `=HYPERLINK(…)` or `=WEBSERVICE(…)`
 * planted there would run when the file was opened. Numbers — and numbers
 * written as text, like "-12.50" — are never touched.
 */
export function neutralizeFormula(v: unknown): unknown {
  if (typeof v !== "string") return v;
  if (!FORMULA_START.test(v) || PLAIN_NUMBER.test(v)) return v;
  return `'${v}`;
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(neutralizeFormula(v));
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(",");
  const body = rows
    .map((r, i) =>
      columns.map((c) => escapeCell(c.value(r, i))).join(","),
    )
    .join("\n");
  return `\uFEFF${header}\n${body}\n`;
}

/**
 * CSV from a header row + already-formatted cells, for tables whose columns are
 * built dynamically (Reconciliation's by-platform mode has a column per
 * platform). `rowsToCsv` needs a static column list; this doesn't.
 */
export function matrixToCsv(
  head: string[],
  rows: Array<Array<string | number>>,
): string {
  return [head, ...rows].map((r) => r.map(escapeCell).join(",")).join("\n");
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function todayStamp(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
