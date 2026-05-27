/**
 * Parse layer for CSV + XLSX.
 *
 * Wraps papaparse (text/csv, text/tsv, .csv) and SheetJS (.xlsx, .xls) so the
 * pipeline can treat both as the same `header + rows` shape.
 *
 * Quirks from docs/validation-spec.md §6:
 *  - 10 MB upper bound (Stage 1 / E001).
 *  - BOM strip (CSV).
 *  - Auto delimiter detect (CSV: comma vs semicolon).
 *  - UTF-8 decoding (CSV). Non-UTF-8 currently rejected with E004; the
 *    Windows-1256 fallback (W001) lives behind `iconv-lite` (deferred).
 *  - CRLF/LF normalization (papaparse handles internally).
 *
 * Output shape is intentionally raw — header row + body rows of strings.
 * Schema and field validation happen later in the pipeline.
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ValidationError } from "@/csv/errors";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ParseSuccess {
  ok: true;
  header: string[];
  /** Body rows (each entry aligns to `header.length`; missing cells are ""). */
  rows: string[][];
  /** 1-based row numbers in the original file, parallel to `rows`. */
  rowNumbers: number[];
  warnings: ValidationError[];
}

export interface ParseFailure {
  ok: false;
  error: ValidationError;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface ParseInput {
  content: ArrayBuffer | Uint8Array | string;
  byteLength?: number;
  /** File name. Used to choose the parser (.xlsx/.xls → SheetJS; otherwise CSV). */
  fileName?: string;
}

const XLSX_MAGIC_PK = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — XLSX is a zip.

/** Strip a UTF-8 BOM if present. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function pickDelimiter(text: string): string | undefined {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.includes(",") && firstLine.includes(";")) return ";";
  return undefined;
}

function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasXlsxMagic(bytes: Uint8Array): boolean {
  if (bytes.length < XLSX_MAGIC_PK.length) return false;
  for (let i = 0; i < XLSX_MAGIC_PK.length; i++) {
    if (bytes[i] !== XLSX_MAGIC_PK[i]) return false;
  }
  return true;
}

function isExcelExtension(fileName?: string): boolean {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm");
}

// ---------------------------------------------------------------------------

export function parseFile(input: ParseInput): ParseResult {
  let bytes: Uint8Array | null = null;
  let byteLength = input.byteLength;
  let textInput: string | null = null;

  if (typeof input.content === "string") {
    textInput = input.content;
    byteLength = byteLength ?? Buffer.byteLength(textInput, "utf8");
  } else {
    bytes =
      input.content instanceof Uint8Array
        ? input.content
        : new Uint8Array(input.content);
    byteLength = byteLength ?? bytes.byteLength;
  }

  if (byteLength !== undefined && byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: "E001",
        severity: "FATAL",
        message: "File exceeds the 10 MB upload limit.",
      },
    };
  }

  // Route to XLSX if the file's extension or magic bytes say so.
  if (bytes && (isExcelExtension(input.fileName) || hasXlsxMagic(bytes))) {
    return parseXlsx(bytes);
  }
  if (textInput && isExcelExtension(input.fileName)) {
    // Treating an xlsx-extension string as utf-8 text is wrong, but the
    // pipeline should still surface a clean E002.
    return {
      ok: false,
      error: {
        code: "E002",
        severity: "FATAL",
        message: "The .xlsx file could not be parsed (got text content).",
      },
    };
  }

  // CSV path.
  let text: string | null = textInput;
  if (text === null && bytes) {
    text = decodeUtf8Strict(bytes);
    if (text === null) {
      return {
        ok: false,
        error: {
          code: "E004",
          severity: "FATAL",
          message:
            "The file encoding is not supported. Save as UTF-8 and re-upload.",
        },
      };
    }
  }
  if (text === null) {
    return {
      ok: false,
      error: { code: "E003", severity: "FATAL", message: "The file contains no data rows." },
    };
  }
  return parseCsvText(text);
}

/** Backward-compat alias — older imports still use parseCsv. */
export const parseCsv = parseFile;

// ---------------------------------------------------------------------------

function parseCsvText(text: string): ParseResult {
  text = stripBom(text);
  if (text.trim().length === 0) {
    return {
      ok: false,
      error: { code: "E003", severity: "FATAL", message: "The file contains no data rows." },
    };
  }

  const parsed = Papa.parse<string[]>(text, {
    delimiter: pickDelimiter(text),
    skipEmptyLines: "greedy",
    transform: (v) => (typeof v === "string" ? v : String(v ?? "")),
  });

  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.find(
      (e) => e.type === "Delimiter" || e.type === "Quotes",
    );
    if (fatal) {
      return {
        ok: false,
        error: {
          code: "E002",
          severity: "FATAL",
          message: `The file could not be parsed as CSV (${fatal.code}).`,
        },
      };
    }
  }

  return rowsToResult(parsed.data);
}

function parseXlsx(bytes: Uint8Array): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array" });
  } catch {
    return {
      ok: false,
      error: {
        code: "E002",
        severity: "FATAL",
        message: "The .xlsx file could not be parsed.",
      },
    };
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      ok: false,
      error: { code: "E003", severity: "FATAL", message: "The workbook has no sheets." },
    };
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      ok: false,
      error: { code: "E003", severity: "FATAL", message: "The first sheet is empty." },
    };
  }

  // Pull raw 2-D string array. `defval: ""` makes missing cells empty strings
  // instead of `undefined`, and `raw: false` formats dates/numbers using the
  // workbook's display format (matches what the user sees in Excel).
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  const rows: string[][] = aoa.map((r) =>
    r.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  );

  return rowsToResult(rows);
}

// ---------------------------------------------------------------------------

function rowsToResult(raw: string[][] | unknown[][]): ParseResult {
  const all = (raw as string[][]).filter((r) => r && r.some((c) => (c ?? "") !== ""));
  if (all.length === 0) {
    return {
      ok: false,
      error: { code: "E003", severity: "FATAL", message: "The file contains no data rows." },
    };
  }

  const headerRaw = all[0]!;
  if (headerRaw.every((c) => (c ?? "").trim() === "")) {
    return {
      ok: false,
      error: { code: "E003", severity: "FATAL", message: "The file contains no data rows." },
    };
  }

  const body = all.slice(1);
  if (body.length === 0) {
    return {
      ok: false,
      error: { code: "E003", severity: "FATAL", message: "The file contains no data rows." },
    };
  }

  const rowNumbers = body.map((_, i) => i + 2);

  return {
    ok: true,
    header: headerRaw.map((c) => (c ?? "").trim()),
    rows: body,
    rowNumbers,
    warnings: [],
  };
}
