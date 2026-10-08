/**
 * Parse layer for CSV + XLSX.
 *
 * Wraps papaparse (text/csv, text/tsv, .csv) and SheetJS (.xlsx, .xls) so the
 * pipeline can treat both as the same `header + rows` shape. **This is the ONE
 * conversion layer**: every upload surface (ads, store orders, bulk creative
 * import, the budget plan sheet) comes through here, so a workbook and a CSV
 * reach the validators as byte-identical rows of strings and nothing
 * downstream knows which it was.
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

/**
 * Is this plainly a BINARY file rather than mis-encoded text? A NUL byte in
 * the first few KB is the classic test — no text encoding this app accepts
 * produces one, and every binary container (PDF, PNG, legacy .xls, a zip)
 * does almost immediately.
 */
function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 4096);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
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
      // Two different failures wear the same symptom. A file that is plainly
      // BINARY (a PDF, an image, an .xls renamed) is not an encoding problem,
      // and telling someone to "save as UTF-8" sends them nowhere.
      return {
        ok: false,
        error: looksBinary(bytes)
          ? {
              code: "E002",
              severity: "FATAL",
              message:
                "This doesn't look like a CSV or Excel file. Upload a .csv or .xlsx export.",
            }
          : {
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

/**
 * Why a workbook couldn't be read, in words the uploader can act on. A
 * password-protected file is the common one and deserves its own sentence —
 * "could not be parsed" sends someone hunting for a formatting problem that
 * isn't there.
 */
export function xlsxFailure(err: unknown): ValidationError {
  const message = err instanceof Error ? err.message : String(err ?? "");
  // Only a PASSWORD signal gets the password sentence. SheetJS also throws
  // "Unsupported ZIP encryption" for a truncated or corrupt zip, and telling
  // someone to remove a password they never set is a dead end.
  if (/password/i.test(message)) {
    return {
      code: "E002",
      severity: "FATAL",
      message:
        "This workbook is password-protected. Remove the password (File → Info → Protect Workbook) and upload it again.",
    };
  }
  return {
    code: "E002",
    severity: "FATAL",
    message:
      "This Excel file could not be read — it may be corrupt or only partly downloaded. Re-save it as .xlsx and try again.",
  };
}

function parseXlsx(bytes: Uint8Array): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    // `cellDates: true` makes SheetJS hydrate date-typed cells into JS Date
    // objects internally so we can re-serialize them in our preferred format
    // below. Without it, Excel's serial-date numbers leak through.
    workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch (err) {
    return { ok: false, error: xlsxFailure(err) };
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

  // 2-D row array with NATIVE values (`raw: true`). We can't use
  // `raw: false` here — SheetJS would prefer each cell's cached display
  // string (`w`), and Excel files authored in a US locale cache
  // `15/02/2026` as `"2/15/26"` regardless of any `dateNF` option. With
  // `raw: true` plus `cellDates: true` on `XLSX.read`, date cells arrive as
  // JS Date objects and we format them ourselves to ISO below.
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: true,
  });

  const rows: string[][] = aoa.map((r) =>
    r.map((cell) => {
      if (cell === null || cell === undefined) return "";
      if (cell instanceof Date) {
        // Use UTC so a date typed in any timezone serializes consistently.
        const y = cell.getUTCFullYear();
        const m = String(cell.getUTCMonth() + 1).padStart(2, "0");
        const d = String(cell.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
      if (typeof cell === "number") {
        return numberToPlainString(cell);
      }
      if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
      return String(cell);
    }),
  );

  const result = rowsToResult(rows);
  // A workbook with several sheets is read FIRST-SHEET-ONLY, and says so:
  // silently ignoring four other tabs is how someone uploads the summary tab
  // and wonders where their data went.
  if (result.ok && workbook.SheetNames.length > 1) {
    result.warnings = [
      ...result.warnings,
      {
        code: "W003",
        severity: "WARNING",
        message: `This workbook has ${workbook.SheetNames.length} sheets — only the first one (\u201C${sheetName}\u201D) was read.`,
      },
    ];
  }
  return result;
}

// ---------------------------------------------------------------------------

/**
 * A cell's number as a PLAIN decimal string — never `1e+21`, never a locale
 * separator. The validators parse these back with `Number()`, and a
 * spreadsheet full of large ids or spends must not arrive in exponent form
 * (which is one of the two things CSV exports get wrong and a workbook
 * otherwise gets right).
 */
export function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = n.toString();
  if (!s.includes("e") && !s.includes("E")) return s;
  // Exponent form → fixed notation, by hand. `toFixed` can't do it: it
  // returns exponent form again at 1e21 and above, and caps at 100 decimals
  // below.
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (!m) return s;
  const [, sign = "", intPart = "0", fracPart = "", expPart = "0"] = m;
  const digits = intPart + fracPart;
  // Where the decimal point lands inside `digits`.
  const point = Number(expPart) + intPart.length;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

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
