/**
 * 5-stage CSV validation pipeline.
 *
 * Per docs/validation-spec.md §3:
 *   Stage 1 — file integrity   (fail-fast)
 *   Stage 2 — schema           (fail-fast)
 *   Stage 3 — row content      (collect errors)
 *   Stage 4 — intra-file dupes (collect errors)
 *   Stage 5 — DB dupes         (collect errors)
 *
 * `runPipeline()` is platform-agnostic. The platform adapter from
 * `csv/platforms/` supplies header mapping, required fields, accepted date
 * formats, and row-skip rules. The DB-dupe lookup is injected so the pipeline
 * can be tested without a database.
 */
import { parseCsv, type ParseInput } from "@/csv/parse";
import { ADAPTERS } from "@/csv/platforms";
import type {
  DateFormat,
  InternalField,
  PlatformAdapter,
} from "@/csv/platforms/types";
import type { ValidationError } from "@/csv/errors";
import { buildCampaignName } from "@/lib/campaign";

type Platform = PlatformAdapter["platform"];

export interface ParsedRow {
  rowNumber: number;
  creativeName: string;
  date: string; // canonical YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  /** Combined "Campaign ➤ Adset", with " (Instagram)"/" (Facebook)" appended for those two platforms (see lib/campaign.ts). */
  campaignName: string;
  landingPageViews: number | null;
  videoViews2s: number | null;
  videoViews25: number | null;
  videoViews50: number | null;
  videoViews75: number | null;
  videoViews100: number | null;
  /** Raw cell values keyed by original header. Stored on the perf record. */
  rawPayload: Record<string, string>;
}

export interface PipelineSuccess {
  ok: true;
  rows: ParsedRow[];
  warnings: ValidationError[];
}
export interface PipelineFailure {
  ok: false;
  errors: ValidationError[];
  warnings: ValidationError[];
}
export type PipelineResult = PipelineSuccess | PipelineFailure;

export interface PipelineInput extends ParseInput {
  /**
   * Either pass a fully-resolved `adapter` (the route handler should
   * `await resolveAdapter(platform)` to read DB-edited header maps), or pass
   * a `platform` and let the pipeline fall back to the code-level ADAPTERS
   * map (handy for tests).
   */
  adapter?: PlatformAdapter;
  platform?: Platform;
  /** All creative names registered in the library, used for strict matching. */
  registeredNames: Set<string>;
  /** Returns the existing batch id for a (name, platform, campaign, date) tuple, or null. */
  findExistingBatch?: (
    creativeName: string,
    platform: Platform,
    campaignName: string,
    date: string,
  ) => Promise<string | null>;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const adapter =
    input.adapter ??
    (input.platform ? ADAPTERS[input.platform] : undefined);
  if (!adapter) {
    throw new Error("runPipeline: pass either `adapter` or `platform`.");
  }
  const platform: Platform = adapter.platform;
  const warnings: ValidationError[] = [];

  // ---------- Stage 1 ----------
  const parsed = parseCsv({
    content: input.content,
    byteLength: input.byteLength,
  });
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error], warnings };
  }
  warnings.push(...parsed.warnings);

  // ---------- Stage 2 — schema ----------
  // Case-insensitive header lookup.
  const headerLookup = new Map<string, number>();
  const seenLower = new Set<string>();
  for (let i = 0; i < parsed.header.length; i++) {
    const h = parsed.header[i]!;
    const key = h.toLowerCase();
    if (seenLower.has(key) && h.trim() !== "") {
      return {
        ok: false,
        errors: [
          {
            code: "E012",
            severity: "FATAL",
            message: `Duplicate header column: \`${h}\`.`,
          },
        ],
        warnings,
      };
    }
    seenLower.add(key);
    headerLookup.set(key, i);
  }

  /** Internal field → column index in the parsed body, or undefined if not present. */
  const fieldIndex: Partial<Record<InternalField, number>> = {};
  /** Internal field → the actual header string we matched (for raw-payload keys). */
  const fieldHeader: Partial<Record<InternalField, string>> = {};

  for (const field of Object.keys(adapter.headerMap) as InternalField[]) {
    const candidates = adapter.headerMap[field];
    for (const candidate of candidates) {
      const idx = headerLookup.get(candidate.toLowerCase());
      if (idx !== undefined) {
        fieldIndex[field] = idx;
        fieldHeader[field] = parsed.header[idx];
        break;
      }
    }
  }

  // Stage 2 fatal: every required field must be present.
  const missingHeaders: ValidationError[] = [];
  for (const required of adapter.requiredFields) {
    if (fieldIndex[required] === undefined) {
      const firstCandidate = adapter.headerMap[required][0] ?? required;
      missingHeaders.push({
        code: "E010",
        severity: "FATAL",
        message: `Required column missing: \`${firstCandidate}\`.`,
        field: required,
      });
    }
  }
  if (missingHeaders.length > 0) {
    return { ok: false, errors: missingHeaders, warnings };
  }

  // W002 — unknown columns (everything in the header that we didn't map).
  const mappedIndices = new Set(Object.values(fieldIndex));
  for (let i = 0; i < parsed.header.length; i++) {
    if (!mappedIndices.has(i) && parsed.header[i]!.trim() !== "") {
      warnings.push({
        code: "W002",
        severity: "WARNING",
        message: `Unknown column ignored: \`${parsed.header[i]}\`.`,
      });
    }
  }

  // ---------- Stages 3 + 4 ----------
  const collected: ValidationError[] = [];
  const accepted: ParsedRow[] = [];
  /**
   * Dedup index keyed on (creative, campaign, date) — platform is constant
   * per file. Drives Stage 4 (intra-file duplicate -> E050) and Stage 5
   * (already imported in DB -> E051). The key joins the three fields with a
   * U+0001 (SOH) control char that cannot appear in a CSV cell; the loops below
   * split("\u0001") to recover them. NOTE: that separator is an INVISIBLE
   * control character in the key/split lines below (it will not render in most
   * editors or diff/read tools) - do not "fix" an apparent missing delimiter.
   */
  const seenKeys = new Map<string, number[]>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const csvRow = parsed.rows[i]!;
    const rowNumber = parsed.rowNumbers[i]!;

    // Project to internal-field cells.
    const cell = (f: InternalField): string => {
      const idx = fieldIndex[f];
      if (idx === undefined) return "";
      return (csvRow[idx] ?? "").trim();
    };
    const allCells: Partial<Record<InternalField, string>> = {};
    for (const f of Object.keys(fieldIndex) as InternalField[]) {
      allCells[f] = cell(f);
    }

    // skipRow rule (subtotal / grand-total rows).
    if (adapter.skipRow?.(allCells)) continue;

    const errorsForRow: ValidationError[] = [];

    // E021 / E020 — creative_name
    const creativeName = allCells.creative_name ?? "";
    if (creativeName === "") {
      errorsForRow.push({
        code: "E021",
        severity: "ERROR",
        message: `Row ${rowNumber}: creative name is empty.`,
        row: rowNumber,
      });
    } else if (!input.registeredNames.has(creativeName)) {
      errorsForRow.push({
        code: "E020",
        severity: "ERROR",
        message: `Row ${rowNumber}: creative \`'${creativeName}'\` is not registered in the library.`,
        row: rowNumber,
        value: creativeName,
      });
    }

    // E030 / E031 — date
    const rawDate = allCells.date ?? "";
    let canonicalDate: string | null = null;
    if (rawDate === "") {
      errorsForRow.push({
        code: "E042",
        severity: "ERROR",
        message: `Row ${rowNumber}: required field \`'date'\` is missing.`,
        row: rowNumber,
        field: "date",
      });
    } else {
      canonicalDate = parseDate(rawDate, adapter.acceptedDateFormats);
      if (canonicalDate === null) {
        errorsForRow.push({
          code: "E030",
          severity: "ERROR",
          message: `Row ${rowNumber}: invalid date \`'${rawDate}'\`.`,
          row: rowNumber,
          value: rawDate,
          field: "date",
        });
      } else if (isMoreThanADayInFuture(canonicalDate)) {
        errorsForRow.push({
          code: "E031",
          severity: "ERROR",
          message: `Row ${rowNumber}: date \`'${rawDate}'\` is in the future.`,
          row: rowNumber,
          value: rawDate,
          field: "date",
        });
      }
    }

    // E042 - campaign_name and adset_name are required (both feed the combined
    // "Campaign ➤ Adset" value, the dedup key, and the unique index). A blank
    // on either side must fail the row, not silently store a half/empty value.
    for (const reqField of ["campaign_name", "adset_name"] as const) {
      if ((allCells[reqField] ?? "") === "") {
        errorsForRow.push({
          code: "E042",
          severity: "ERROR",
          message: `Row ${rowNumber}: required field \`'${reqField}'\` is missing.`,
          row: rowNumber,
          field: reqField,
        });
      }
    }

    // Numeric fields: all-or-nothing at the column level (the adapter's
    // requiredFields decides which headers must exist). Within a row, a blank
    // cell defaults to 0 — a day with no conversions is a real, valid row.
    // Non-numeric strings or negatives still trigger E040 / E041.
    const parseNumericCell = (field: InternalField): number | null => {
      const raw = allCells[field] ?? "";
      if (isEmptyMarker(raw)) return 0;
      const parsedNumeric = parseNumber(raw);
      if (parsedNumeric === null) {
        errorsForRow.push({
          code: "E040",
          severity: "ERROR",
          message: `Row ${rowNumber}: \`'${field}'\` is not a valid number (\`'${raw}'\`).`,
          row: rowNumber,
          value: raw,
          field,
        });
        return null;
      }
      if (parsedNumeric < 0) {
        errorsForRow.push({
          code: "E041",
          severity: "ERROR",
          message: `Row ${rowNumber}: \`'${field}'\` must be non-negative (got ${parsedNumeric}).`,
          row: rowNumber,
          value: raw,
          field,
        });
        return null;
      }
      return parsedNumeric;
    };

    const spend = parseNumericCell("spend");
    const impressions = parseNumericCell("impressions");
    const clicks = parseNumericCell("clicks");
    const conversions = parseNumericCell("conversions");
    const conversionValue = parseNumericCell("conversion_value");
    const landingPageViews = parseNumericCell("landing_page_views");
    const videoViews2s = parseNumericCell("video_views_2s");
    const videoViews25 = parseNumericCell("video_views_25");
    const videoViews50 = parseNumericCell("video_views_50");
    const videoViews75 = parseNumericCell("video_views_75");
    const videoViews100 = parseNumericCell("video_views_100");

    if (errorsForRow.length > 0) {
      collected.push(...errorsForRow);
      continue;
    }
    if (canonicalDate === null || spend === null || impressions === null || clicks === null) {
      continue;
    }

    // Build the raw payload from the original cells (keyed by header).
    const rawPayload: Record<string, string> = {};
    for (let h = 0; h < parsed.header.length; h++) {
      const key = parsed.header[h] ?? `col_${h}`;
      rawPayload[key] = csvRow[h] ?? "";
    }

    // Combine the two campaign columns into the single stored value. The UI
    // only ever shows this as "Campaign Name".
    const campaignName = buildCampaignName(
      allCells.campaign_name ?? "",
      allCells.adset_name ?? "",
      platform,
    );

    accepted.push({
      rowNumber,
      creativeName,
      campaignName,
      date: canonicalDate,
      spend,
      impressions: Math.floor(impressions),
      clicks: Math.floor(clicks),
      conversions,
      conversionValue,
      landingPageViews:
        landingPageViews === null ? null : Math.floor(landingPageViews),
      videoViews2s: videoViews2s === null ? null : Math.floor(videoViews2s),
      videoViews25: videoViews25 === null ? null : Math.floor(videoViews25),
      videoViews50: videoViews50 === null ? null : Math.floor(videoViews50),
      videoViews75: videoViews75 === null ? null : Math.floor(videoViews75),
      videoViews100: videoViews100 === null ? null : Math.floor(videoViews100),
      rawPayload,
    });

    // Stage 4 — index this row by the full dedup key (creative, campaign,
    // date; platform is constant per file).
    const key = `${creativeName}${campaignName}${canonicalDate}`;
    const list = seenKeys.get(key);
    if (list) list.push(rowNumber);
    else seenKeys.set(key, [rowNumber]);
  }

  // Stage 4 emit — reject intra-file duplicates on (creative, campaign, date).
  // Different campaigns are distinct keys, so legitimate multi-campaign rows
  // are allowed.
  for (const [k, rowNums] of seenKeys) {
    if (rowNums.length > 1) {
      const parts = k.split("");
      collected.push({
        code: "E050",
        severity: "ERROR",
        message: `Rows ${rowNums.join(", ")}: duplicate within file — same creative \`'${parts[0]}'\`, campaign \`'${parts[1]}'\`, platform \`${platform}\`, date \`${parts[2]}\`.`,
        rows: rowNums,
        value: parts[0],
      });
    }
  }

  // ---------- Stage 5 — already imported (blocking) ----------
  // A row matching (creative, platform, campaign, date) already in the DB is a
  // true duplicate now that campaign disambiguates multi-campaign rows.
  if (input.findExistingBatch && accepted.length > 0) {
    for (const [k, rowNums] of seenKeys) {
      if (rowNums.length > 1) continue; // already reported as E050
      const parts = k.split("");
      const batchId = await input.findExistingBatch(parts[0]!, platform, parts[1]!, parts[2]!);
      if (batchId) {
        collected.push({
          code: "E051",
          severity: "ERROR",
          message: `Row(s) ${rowNums.join(", ")}: \`'${parts[0]}'\` / campaign \`'${parts[1]}'\` on \`${platform}\` for \`${parts[2]}\` was already imported (batch ${batchId}). Roll back that batch to re-import.`,
          rows: rowNums,
          value: parts[0],
        });
      }
    }
  }

  if (collected.length > 0) {
    return { ok: false, errors: collected, warnings };
  }
  return { ok: true, rows: accepted, warnings };
}

// ---------- helpers ----------

/** True for the various "empty" representations the spec calls out. */
function isEmptyMarker(s: string): boolean {
  if (s === "") return true;
  const v = s.trim().toLowerCase();
  return v === "" || v === "-" || v === "—" || v === "n/a" || v === "null";
}

/** Parse `"1,234.56"` / `"$1,234"` / `"1234 USD"` to 1234.56. Returns null on failure. */
export function parseNumber(raw: string): number | null {
  if (isEmptyMarker(raw)) return null;
  let cleaned = raw.trim();
  // strip leading currency symbols
  cleaned = cleaned.replace(/^[$£€¥]+/u, "");
  // strip thousand-separators
  cleaned = cleaned.replace(/,/g, "");
  // strip trailing unit / currency strings ("USD", "EGP", etc.)
  cleaned = cleaned.replace(/[\sA-Za-z]+$/u, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Try the accepted formats in order; return canonical YYYY-MM-DD or null.
 *
 * Slash / dash / dot are all accepted as separators for MM/DD/YYYY and
 * DD/MM/YYYY (e.g. `28/05/2026`, `28-05-2026`, `28.05.2026` all work).
 * Ambiguous inputs (`05/04/2026`) resolve to whichever format the adapter
 * lists first. Inputs where one position exceeds 12 (e.g. `28/05/2026`)
 * are unambiguous regardless of order — the wrong interpretation simply
 * fails the calendar-validity check and the next format is tried.
 */
export function parseDate(raw: string, formats: DateFormat[]): string | null {
  const s = raw.trim();
  const slashOrDashOrDot = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
  for (const fmt of formats) {
    let m: RegExpMatchArray | null = null;
    let y: number | undefined;
    let mo: number | undefined;
    let d: number | undefined;
    if (fmt === "YYYY-MM-DD" && (m = s.match(/^(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})$/))) {
      y = +m[1]!; mo = +m[2]!; d = +m[3]!;
    } else if (fmt === "MM/DD/YYYY" && (m = s.match(slashOrDashOrDot))) {
      mo = +m[1]!; d = +m[2]!; y = +m[3]!;
    } else if (fmt === "DD/MM/YYYY" && (m = s.match(slashOrDashOrDot))) {
      d = +m[1]!; mo = +m[2]!; y = +m[3]!;
    } else if (fmt === "D Mon YYYY" && (m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/))) {
      d = +m[1]!;
      mo = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
      y = +m[3]!;
    }
    if (y !== undefined && mo !== undefined && d !== undefined) {
      if (!isValidYmd(y, mo, d)) continue;
      return `${pad4(y)}-${pad2(mo)}-${pad2(d)}`;
    }
  }
  return null;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

function isMoreThanADayInFuture(ymd: string): boolean {
  const parts = ymd.split("-").map(Number);
  const t = Date.UTC(parts[0]!, (parts[1]! - 1), parts[2]!);
  return t > Date.now() + 24 * 60 * 60 * 1000;
}
