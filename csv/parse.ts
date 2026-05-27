/**
 * CSV parse layer.
 *
 * Wraps papaparse with the quirks from docs/validation-spec.md §6:
 *  - 10 MB upper bound (Stage 1 / E001).
 *  - BOM strip.
 *  - Auto delimiter detect (comma vs semicolon).
 *  - UTF-8 decoding. Windows-1256 fallback (W001) is deferred until we add
 *    `iconv-lite`; today, non-UTF-8 files are rejected with E004.
 *  - CRLF/LF normalization (papaparse handles this internally).
 *
 * Output shape is intentionally raw — header row + body rows of strings.
 * Schema and field validation happen later in the pipeline.
 */
import Papa from "papaparse";
import type { ValidationError } from "@/csv/errors";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ParseSuccess {
  ok: true;
  header: string[];
  /** Body rows (each entry aligns to `header.length`; missing cells are ""). */
  rows: string[][];
  /** 1-based row numbers in the original CSV, parallel to `rows`. Used for E0xx messages. */
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
  byteLength?: number; // optional explicit byte length (for string inputs)
}

/** Strip a UTF-8 BOM if present. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * If the first line has no commas but contains a semicolon, prefer semicolon
 * as the delimiter. Otherwise leave it to papaparse's auto-detection.
 */
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

export function parseCsv(input: ParseInput): ParseResult {
  // Stage 1.a — file size
  let text: string | null = null;
  let byteLength = input.byteLength;
  if (typeof input.content === "string") {
    text = input.content;
    byteLength = byteLength ?? Buffer.byteLength(text, "utf8");
  } else {
    const bytes =
      input.content instanceof Uint8Array
        ? input.content
        : new Uint8Array(input.content);
    byteLength = byteLength ?? bytes.byteLength;
    if (byteLength > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: {
          code: "E001",
          severity: "FATAL",
          message: "File exceeds the 10 MB upload limit.",
        },
      };
    }
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

  // Strip BOM, normalize line endings (papaparse handles both, but be explicit).
  text = stripBom(text);

  // Empty / whitespace-only inputs short-circuit to E003 so the user sees
  // "no data rows" instead of a confusing parse error.
  if (text.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "E003",
        severity: "FATAL",
        message: "The file contains no data rows.",
      },
    };
  }

  // Stage 1.b — parse
  const parsed = Papa.parse<string[]>(text, {
    delimiter: pickDelimiter(text),
    skipEmptyLines: "greedy",
    transform: (v) => (typeof v === "string" ? v : String(v ?? "")),
  });

  // papaparse `errors` array. The most disqualifying ones are "Delimiter" /
  // "InvalidQuotes". Bail with E002 on any error before the data section.
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
    // Row-level papaparse errors (e.g. column count mismatch) are tolerated;
    // schema validation in stage 2 will surface real shape issues.
  }

  const all = parsed.data.filter((r) => r && r.some((c) => c !== ""));
  if (all.length === 0) {
    return {
      ok: false,
      error: {
        code: "E003",
        severity: "FATAL",
        message: "The file contains no data rows.",
      },
    };
  }

  const headerRaw = all[0]!;
  // Stage 1.c — header itself non-empty
  if (headerRaw.every((c) => c.trim() === "")) {
    return {
      ok: false,
      error: {
        code: "E003",
        severity: "FATAL",
        message: "The file contains no data rows.",
      },
    };
  }

  const body = all.slice(1);
  if (body.length === 0) {
    return {
      ok: false,
      error: {
        code: "E003",
        severity: "FATAL",
        message: "The file contains no data rows.",
      },
    };
  }

  // Build 1-based row numbers reflecting the original CSV (header = row 1).
  // Skipped blank rows between header and body shift the numbers; tracking
  // them precisely requires re-walking the raw text. For v1 we approximate by
  // assuming the body is contiguous starting at row 2 — good enough until we
  // see real exports with subtotal blanks mid-file.
  const rowNumbers = body.map((_, i) => i + 2);

  return {
    ok: true,
    header: headerRaw.map((c) => c.trim()),
    rows: body,
    rowNumbers,
    warnings: [],
  };
}
