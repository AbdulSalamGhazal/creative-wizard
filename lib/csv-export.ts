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

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
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
  return `﻿${header}\n${body}\n`;
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
