import { parseFile, MAX_FILE_BYTES, type ParseInput } from "@/csv/parse";
import { err, type StoreErrorCode, type StoreValidationError } from "./errors";

/**
 * Thin wrapper over the SHARED ads parser (`csv/parse.ts` — papaparse + xlsx,
 * unchanged). We reuse the parsing engine but translate its file-integrity
 * failures into the Store module's own S-codes, so the ads catalog never leaks
 * into store errors.
 */

export { MAX_FILE_BYTES };
export type { ParseInput };

export interface StoreParseSuccess {
  ok: true;
  header: string[]; // trimmed
  rows: string[][]; // aligned to header length; missing cells ""
  rowNumbers: number[]; // 1-based original file row numbers, parallel to rows
  /** Parse-level notices (today: "this workbook had several sheets"). */
  warnings: StoreValidationError[];
}
export interface StoreParseFailure {
  ok: false;
  error: StoreValidationError;
}
export type StoreParseResult = StoreParseSuccess | StoreParseFailure;

// csv E00x file-integrity codes → store S00x.
const CODE_MAP: Record<string, StoreErrorCode> = {
  E001: "S001",
  E002: "S002",
  E003: "S003",
  E004: "S004",
};

// …and the parse-level WARNINGS the shared parser can raise.
const WARNING_MAP: Record<string, StoreErrorCode> = {
  W003: "S061",
};

export function parseStoreFile(input: ParseInput): StoreParseResult {
  const res = parseFile(input);
  if (!res.ok) {
    const code = CODE_MAP[res.error.code] ?? "S002";
    return { ok: false, error: err(code, res.error.message) };
  }
  return {
    ok: true,
    header: res.header,
    rows: res.rows,
    rowNumbers: res.rowNumbers,
    // The ads catalog never leaks into store errors — the first-sheet notice
    // is re-coded, like every other shared-parser message.
    warnings: res.warnings.map((w) => err(WARNING_MAP[w.code] ?? "S060", w.message)),
  };
}

/**
 * Parse a Salla order date. Accepts `YYYY-MM-DD` and
 * `YYYY-MM-DD HH:MM:SS` / `YYYY-MM-DDTHH:MM:SS` — Salla exports use Riyadh local
 * time, so we keep the DATE PART verbatim (no timezone shift). Returns the ISO
 * date, or null when it isn't a real calendar date.
 */
export function parseStoreDate(raw: string): string | null {
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  // Validate the calendar date (rejects 2026-02-30 etc.) in UTC.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

/**
 * Parse a money/number cell: strip currency symbols (SAR, ﷼, $, etc.), spaces,
 * and thousands separators, then parse. Returns null when what's left isn't a
 * finite number. A bare "" is treated as absent by the caller, not here.
 */
export function parseStoreNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    // Drop anything that isn't a digit, minus, or dot (kills SAR/﷼/$/commas/spaces/Arabic).
    .replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
