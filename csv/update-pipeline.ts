/**
 * Bulk-UPDATE validation pipeline.
 *
 * The inverse of the import pipeline's Stage 5: instead of rejecting rows that
 * already exist, a bulk update REQUIRES the (creative, platform, campaign ➤
 * adset, date) identity to already exist and updates only the value columns
 * present in the file.
 *
 * This stage is DB-free (stages 1–4): it parses, checks headers, validates the
 * identity + the included value columns, and de-dupes within the file. The
 * route then matches each candidate against the database (Stage 5), turning
 * any unmatched row into an E060 error (all-or-nothing).
 *
 * Decisions (confirmed with the user):
 *  - All-or-nothing: any unmatched row blocks the whole file.
 *  - A blank cell in an INCLUDED value column is an error (E062) — never a
 *    silent 0 — so a bulk update can't accidentally wipe a metric. Columns you
 *    omit entirely are never touched.
 *  - At least one value column must be present (E061), else there's nothing to
 *    update.
 */
import { parseCsv, type ParseInput } from "@/csv/parse";
import { ADAPTERS } from "@/csv/platforms";
import type { InternalField, PlatformAdapter } from "@/csv/platforms/types";
import type { ValidationError } from "@/csv/errors";
import { buildCampaignName } from "@/lib/campaign";
import { parseDate, parseNumber } from "@/csv/pipeline";

type Platform = PlatformAdapter["platform"];

/** Columns that identify a record (and must all be present). */
export const IDENTITY_FIELDS: InternalField[] = [
  "creative_name",
  "campaign_name",
  "adset_name",
  "date",
];

/** Columns whose values a bulk update may overwrite. */
export const UPDATABLE_FIELDS: InternalField[] = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversion_value",
  "landing_page_views",
  "video_views_2s",
  "video_views_25",
  "video_views_50",
  "video_views_75",
  "video_views_100",
];

const INTEGER_FIELDS = new Set<InternalField>([
  "impressions",
  "clicks",
  "conversions",
  "landing_page_views",
  "video_views_2s",
  "video_views_25",
  "video_views_50",
  "video_views_75",
  "video_views_100",
]);

/** Key separator — a control char that can't appear in a CSV cell. */
const SEP = "\u0001";

export interface UpdateCandidate {
  rowNumber: number;
  creativeName: string;
  campaignName: string;
  date: string;
  /** Present value columns → their new value. */
  updates: Partial<Record<InternalField, number>>;
}

export interface UpdatePipelineSuccess {
  ok: true;
  candidates: UpdateCandidate[];
  /** The value columns present in the file (the ones being updated). */
  updateFields: InternalField[];
  warnings: ValidationError[];
}
export interface UpdatePipelineFailure {
  ok: false;
  errors: ValidationError[];
  warnings: ValidationError[];
}
export type UpdatePipelineResult =
  | UpdatePipelineSuccess
  | UpdatePipelineFailure;

export interface UpdatePipelineInput extends ParseInput {
  adapter?: PlatformAdapter;
  platform?: Platform;
  registeredNames: Set<string>;
}

function isBlank(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === "" || v === "-" || v === "—" || v === "n/a" || v === "null";
}

export function runUpdatePipeline(
  input: UpdatePipelineInput,
): UpdatePipelineResult {
  const adapter =
    input.adapter ?? (input.platform ? ADAPTERS[input.platform] : undefined);
  if (!adapter) {
    throw new Error("runUpdatePipeline: pass either `adapter` or `platform`.");
  }
  const platform: Platform = adapter.platform;
  const warnings: ValidationError[] = [];

  // ---------- Stage 1 — file integrity ----------
  const parsed = parseCsv({ content: input.content, byteLength: input.byteLength });
  if (!parsed.ok) return { ok: false, errors: [parsed.error], warnings };
  warnings.push(...parsed.warnings);

  // ---------- Stage 2 — schema ----------
  const headerLookup = new Map<string, number>();
  const seenLower = new Set<string>();
  for (let i = 0; i < parsed.header.length; i++) {
    const h = parsed.header[i]!;
    const key = h.toLowerCase();
    if (seenLower.has(key) && h.trim() !== "") {
      return {
        ok: false,
        errors: [
          { code: "E012", severity: "FATAL", message: `Duplicate header column: \`${h}\`.` },
        ],
        warnings,
      };
    }
    seenLower.add(key);
    headerLookup.set(key, i);
  }

  const fieldIndex: Partial<Record<InternalField, number>> = {};
  for (const field of Object.keys(adapter.headerMap) as InternalField[]) {
    for (const candidate of adapter.headerMap[field]) {
      const idx = headerLookup.get(candidate.toLowerCase());
      if (idx !== undefined) {
        fieldIndex[field] = idx;
        break;
      }
    }
  }

  // Identity columns are all required.
  const missingHeaders: ValidationError[] = [];
  for (const required of IDENTITY_FIELDS) {
    if (fieldIndex[required] === undefined) {
      const firstCandidate = adapter.headerMap[required]?.[0] ?? required;
      missingHeaders.push({
        code: "E010",
        severity: "FATAL",
        message: `Required identity column missing: \`${firstCandidate}\`.`,
        field: required,
      });
    }
  }
  if (missingHeaders.length > 0) return { ok: false, errors: missingHeaders, warnings };

  // At least one value column must be present.
  const updateFields = UPDATABLE_FIELDS.filter((f) => fieldIndex[f] !== undefined);
  if (updateFields.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "E061",
          severity: "FATAL",
          message:
            "Include at least one value column to update (e.g. spend, conversions, impressions…). Identity columns alone change nothing.",
        },
      ],
      warnings,
    };
  }

  // W002 — unknown columns.
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
  const candidates: UpdateCandidate[] = [];
  const seenKeys = new Map<string, number[]>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const csvRow = parsed.rows[i]!;
    const rowNumber = parsed.rowNumbers[i]!;

    const cell = (f: InternalField): string => {
      const idx = fieldIndex[f];
      if (idx === undefined) return "";
      return (csvRow[idx] ?? "").trim();
    };
    const allCells: Partial<Record<InternalField, string>> = {};
    for (const f of Object.keys(fieldIndex) as InternalField[]) allCells[f] = cell(f);

    if (adapter.skipRow?.(allCells)) continue;

    const errorsForRow: ValidationError[] = [];

    // creative_name (E021 empty / E020 unregistered)
    const creativeName = allCells.creative_name ?? "";
    if (creativeName === "") {
      errorsForRow.push({ code: "E021", severity: "ERROR", message: `Row ${rowNumber}: creative name is empty.`, row: rowNumber });
    } else if (!input.registeredNames.has(creativeName)) {
      errorsForRow.push({ code: "E020", severity: "ERROR", message: `Row ${rowNumber}: creative \`'${creativeName}'\` is not registered in the library.`, row: rowNumber, value: creativeName });
    }

    // date (E042 missing / E030 invalid / E031 future)
    const rawDate = allCells.date ?? "";
    let canonicalDate: string | null = null;
    if (rawDate === "") {
      errorsForRow.push({ code: "E042", severity: "ERROR", message: `Row ${rowNumber}: required field \`'date'\` is missing.`, row: rowNumber, field: "date" });
    } else {
      canonicalDate = parseDate(rawDate, adapter.acceptedDateFormats);
      if (canonicalDate === null) {
        errorsForRow.push({ code: "E030", severity: "ERROR", message: `Row ${rowNumber}: invalid date \`'${rawDate}'\`.`, row: rowNumber, value: rawDate, field: "date" });
      } else if (isMoreThanADayInFuture(canonicalDate)) {
        errorsForRow.push({ code: "E031", severity: "ERROR", message: `Row ${rowNumber}: date \`'${rawDate}'\` is in the future.`, row: rowNumber, value: rawDate, field: "date" });
      }
    }

    // campaign_name + adset_name required (feed the identity)
    for (const reqField of ["campaign_name", "adset_name"] as const) {
      if ((allCells[reqField] ?? "") === "") {
        errorsForRow.push({ code: "E042", severity: "ERROR", message: `Row ${rowNumber}: required field \`'${reqField}'\` is missing.`, row: rowNumber, field: reqField });
      }
    }

    // Value columns: blank in an INCLUDED column is an error (E062), never 0.
    const updates: Partial<Record<InternalField, number>> = {};
    for (const f of updateFields) {
      const raw = allCells[f] ?? "";
      if (isBlank(raw)) {
        errorsForRow.push({ code: "E062", severity: "ERROR", message: `Row ${rowNumber}: \`'${f}'\` is blank — a value is required to update it.`, row: rowNumber, field: f });
        continue;
      }
      const n = parseNumber(raw);
      if (n === null) {
        errorsForRow.push({ code: "E040", severity: "ERROR", message: `Row ${rowNumber}: \`'${f}'\` is not a valid number (\`'${raw}'\`).`, row: rowNumber, value: raw, field: f });
        continue;
      }
      if (n < 0) {
        errorsForRow.push({ code: "E041", severity: "ERROR", message: `Row ${rowNumber}: \`'${f}'\` must be non-negative (got ${n}).`, row: rowNumber, value: raw, field: f });
        continue;
      }
      updates[f] = INTEGER_FIELDS.has(f) ? Math.floor(n) : n;
    }

    if (errorsForRow.length > 0) {
      collected.push(...errorsForRow);
      continue;
    }
    if (canonicalDate === null) continue;

    const campaignName = buildCampaignName(
      allCells.campaign_name ?? "",
      allCells.adset_name ?? "",
      platform,
    );

    candidates.push({ rowNumber, creativeName, campaignName, date: canonicalDate, updates });

    const key = [creativeName, campaignName, canonicalDate].join(SEP);
    const list = seenKeys.get(key);
    if (list) list.push(rowNumber);
    else seenKeys.set(key, [rowNumber]);
  }

  // Stage 4 — intra-file duplicates on the identity.
  for (const [k, rowNums] of seenKeys) {
    if (rowNums.length > 1) {
      const [cn, cmp, dt] = k.split(SEP);
      collected.push({
        code: "E050",
        severity: "ERROR",
        message: `Rows ${rowNums.join(", ")}: duplicate within file — same creative \`'${cn}'\`, campaign \`'${cmp}'\`, platform \`${platform}\`, date \`${dt}\`.`,
        rows: rowNums,
        value: cn,
      });
    }
  }

  if (collected.length > 0) return { ok: false, errors: collected, warnings };
  return { ok: true, candidates, updateFields, warnings };
}

function isMoreThanADayInFuture(ymd: string): boolean {
  const parts = ymd.split("-").map(Number);
  const t = Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!);
  return t > Date.now() + 24 * 60 * 60 * 1000;
}
