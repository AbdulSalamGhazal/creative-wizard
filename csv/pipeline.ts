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
import { isEmptyMarker, parseNumber } from "@/csv/numeric";
import { ADAPTERS } from "@/csv/platforms";
import {
  COUNT_FIELDS,
  FIELD_META,
  isFieldUnavailableOn,
  type DateFormat,
  type InternalField,
  type PlatformAdapter,
} from "@/csv/platforms/types";
import type { ValidationError } from "@/csv/errors";
import { buildCampaignName } from "@/lib/campaign";
import { splitLandingCode, withLandingCode } from "@/lib/landing-code";

type Platform = PlatformAdapter["platform"];

export interface ParsedRow {
  rowNumber: number;
  /** The registered creative's name — the cell BEFORE any ` @code` suffix. */
  creativeName: string;
  /** The ` @code` suffix's landing-page code (no `@`), or null for the
   *  product's own page. Part of the record identity. */
  landingCode: string | null;
  date: string; // canonical YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  /** Combined "Campaign ➤ Adset", with " (IG)"/" (FB)" appended for those two platforms (see lib/campaign.ts). */
  campaignName: string;
  landingPageViews: number | null;
  addToCart: number | null;
  addPayment: number | null;
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
  /** Registered campaign names (the built campaign_name). When provided, a row
   *  whose campaign isn't registered is rejected (E061). Omit to skip the check. */
  registeredCampaigns?: Set<string>;
  /** Registered landing-page codes (no `@`). When provided, a row whose
   *  ` @code` isn't registered is rejected (E023). Omit to skip the check. */
  registeredLandingCodes?: Set<string>;
  /**
   * Each registered creative's product id, and each landing page's (null for
   * a page that still has no product). When BOTH are provided, a row whose
   * ` @code` names a page of a different product than its creative is
   * rejected (E024). Omit either to skip the check.
   */
  creativeProducts?: Map<string, string>;
  landingPageProducts?: Map<string, string | null>;
  /**
   * The ACTIVE records already stored on this platform for the file's
   * (creative, campaign, date) days — called ONCE per file with every day the
   * file carries. It may over-return (e.g. one IN-list query per column);
   * records for days not asked about are ignored. Drives Stage 5; omit to
   * skip it.
   */
  findExisting?: (
    days: ExistingDayQuery[],
    platform: Platform,
  ) => Promise<ExistingRecord[]>;
  /** Upsert mode: an exact identity match is about to be UPDATED, so it is not
   *  E051. The landing-page guard (E052) applies either way. */
  allowExisting?: boolean;
}

/** One (creative, campaign, date) the file carries — a Stage 5 lookup. */
export interface ExistingDayQuery {
  creativeName: string;
  campaignName: string;
  date: string;
}

/** One ACTIVE stored record, at its full identity. */
export interface ExistingRecord extends ExistingDayQuery {
  /** null = the product's own page. */
  landingCode: string | null;
  batchId: string;
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

  // Stage 2 fatal: every required field must be present — EXCEPT one the
  // platform can't report at all (`unavailableOn`; the pipeline stores NULL
  // for it below).
  const missingHeaders: ValidationError[] = [];
  for (const required of adapter.requiredFields) {
    if (isFieldUnavailableOn(required, platform)) continue;
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
  /**
   * The landing codes the FILE carries per (creative, campaign, date) — ""
   * for the product's own page — recorded for EVERY row whose identity
   * resolves, including rows that fail another check. Stage 5's rename guard
   * (E052) reads it: built from accepted rows only, a main-page row failing
   * e.g. E040 made its valid `@code` sibling look like a rename.
   */
  const fileDayCodes = new Map<string, Set<string>>();

  /**
   * COUNT fields land in INTEGER columns, and a platform may report them
   * fractionally — Google's data-driven attribution splits one conversion
   * across touchpoints, so a day reads `11.5`. Those cells are rounded to the
   * nearest whole number HERE, at normalization, so the preview, the summary
   * totals and the committed rows all state the same number; rounding at
   * insert instead would make the confirmation screen a lie. Money fields
   * (`numeric(14,4)`) keep every decimal.
   *
   * Per field: how many cells the rounding actually CHANGED (→ W004).
   */
  const roundedCells = new Map<InternalField, number>();
  const asCount = (field: InternalField, value: number): number => {
    const whole = Math.round(value);
    if (whole !== value) roundedCells.set(field, (roundedCells.get(field) ?? 0) + 1);
    return whole;
  };
  const asCountOrNull = (field: InternalField, value: number | null): number | null =>
    value === null ? null : asCount(field, value);

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

    // E021 / E022 / E020 / E023 — creative_name and its optional ` @code`
    // landing-page suffix (lib/landing-code.ts). The creative matches on the
    // part BEFORE the marker, trim-then-exact as always; the code matches the
    // landing-page registry exactly.
    const creativeCell = allCells.creative_name ?? "";
    let creativeName = creativeCell;
    let landingCode: string | null = null;
    let nameParsed = false;
    if (creativeCell === "") {
      errorsForRow.push({
        code: "E021",
        severity: "ERROR",
        message: `Row ${rowNumber}: creative name is empty.`,
        row: rowNumber,
      });
    } else {
      const split = splitLandingCode(creativeCell);
      if (!split.ok) {
        errorsForRow.push({
          code: "E022",
          severity: "ERROR",
          message: `Row ${rowNumber}: \`'${creativeCell}'\` has a malformed landing page code. Use \`Name @code\` — one space, then @ and letters, digits, - or _.`,
          row: rowNumber,
          field: "creative_name",
          value: creativeCell,
        });
      } else {
        creativeName = split.name;
        landingCode = split.code;
        nameParsed = true;
        if (!input.registeredNames.has(creativeName)) {
          errorsForRow.push({
            code: "E020",
            severity: "ERROR",
            message: `Row ${rowNumber}: creative \`'${creativeName}'\` is not registered in the library.`,
            row: rowNumber,
            value: creativeName,
          });
        }
        if (
          landingCode !== null &&
          input.registeredLandingCodes &&
          !input.registeredLandingCodes.has(landingCode)
        ) {
          errorsForRow.push({
            code: "E023",
            severity: "ERROR",
            message: `Row ${rowNumber}: landing page \`'@${landingCode}'\` is not registered. Add it in Library → Landing pages first.`,
            row: rowNumber,
            field: "creative_name",
            value: landingCode,
          });
        } else if (
          landingCode !== null &&
          input.creativeProducts &&
          input.landingPageProducts
        ) {
          // E024 — the page sells one product; the creative must be that
          // product's. Only when both sides are known: an unregistered
          // creative is already E020, a page with no product yet is skipped.
          const creativeProduct = input.creativeProducts.get(creativeName);
          const pageProduct = input.landingPageProducts.get(landingCode);
          if (
            creativeProduct !== undefined &&
            pageProduct !== undefined &&
            pageProduct !== null &&
            creativeProduct !== pageProduct
          ) {
            errorsForRow.push({
              code: "E024",
              severity: "ERROR",
              message: `Row ${rowNumber}: landing page \`'@${landingCode}'\` belongs to a different product than creative \`'${creativeName}'\`. Use one of that product's landing pages, or fix the ad name.`,
              row: rowNumber,
              field: "creative_name",
              value: landingCode,
            });
          }
        }
      }
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

    /**
     * A field this platform CANNOT report is NULL — never 0. "The platform
     * doesn't measure this" and "the platform measured zero" are different
     * facts, and only NULL keeps the metric out of both sides of a blended
     * ratio (SUM skips NULLs; see lib/metrics.ts). Blank cells in a column
     * that IS present still read as 0 — that standing decision is untouched.
     */
    const numericCell = (field: InternalField): number | null =>
      isFieldUnavailableOn(field, platform) ? null : parseNumericCell(field);

    const spend = numericCell("spend");
    const impressions = numericCell("impressions");
    const clicks = numericCell("clicks");
    const conversions = numericCell("conversions");
    const conversionValue = numericCell("conversion_value");
    const landingPageViews = numericCell("landing_page_views");
    const addToCart = numericCell("add_to_cart");
    const addPayment = numericCell("add_payment");
    const videoViews2s = numericCell("video_views_2s");
    const videoViews25 = numericCell("video_views_25");
    const videoViews50 = numericCell("video_views_50");
    const videoViews75 = numericCell("video_views_75");
    const videoViews100 = numericCell("video_views_100");

    if (
      nameParsed &&
      canonicalDate !== null &&
      (allCells.campaign_name ?? "") !== "" &&
      (allCells.adset_name ?? "") !== ""
    ) {
      const dayKey = `${creativeName}${buildCampaignName(allCells.campaign_name ?? "", allCells.adset_name ?? "", platform)}${canonicalDate}`;
      const codes = fileDayCodes.get(dayKey) ?? new Set<string>();
      codes.add(landingCode ?? "");
      fileDayCodes.set(dayKey, codes);
    }

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

    // E061 — the campaign must be registered (like creatives, E020). Stops a
    // source-side rename from silently creating a new campaign.
    if (input.registeredCampaigns && !input.registeredCampaigns.has(campaignName)) {
      collected.push({
        code: "E061",
        severity: "ERROR",
        message: `Row ${rowNumber}: campaign \`'${campaignName}'\` is not registered. Create it on the Campaigns page first.`,
        row: rowNumber,
        field: "campaign_name",
        value: campaignName,
      });
      continue;
    }

    accepted.push({
      rowNumber,
      creativeName,
      landingCode,
      campaignName,
      date: canonicalDate,
      spend,
      impressions: asCount("impressions", impressions),
      clicks: asCount("clicks", clicks),
      conversions: asCountOrNull("conversions", conversions),
      conversionValue,
      landingPageViews: asCountOrNull("landing_page_views", landingPageViews),
      addToCart: asCountOrNull("add_to_cart", addToCart),
      addPayment: asCountOrNull("add_payment", addPayment),
      videoViews2s: asCountOrNull("video_views_2s", videoViews2s),
      videoViews25: asCountOrNull("video_views_25", videoViews25),
      videoViews50: asCountOrNull("video_views_50", videoViews50),
      videoViews75: asCountOrNull("video_views_75", videoViews75),
      videoViews100: asCountOrNull("video_views_100", videoViews100),
      rawPayload,
    });

    // Stage 4 — index this row by the full dedup key (creative, campaign,
    // date, landing page; platform is constant per file). A landing code is
    // never empty, so "" unambiguously stands for the product's own page.
    const key = `${creativeName}${campaignName}${canonicalDate}${landingCode ?? ""}`;
    const list = seenKeys.get(key);
    if (list) list.push(rowNumber);
    else seenKeys.set(key, [rowNumber]);
  }

  // Stage 4 emit — reject intra-file duplicates on (creative, campaign, date,
  // landing page). Different campaigns or landing pages are distinct keys, so
  // a creative running in several of either on the same day is allowed.
  for (const [k, rowNums] of seenKeys) {
    if (rowNums.length > 1) {
      const parts = k.split("");
      const shown = withLandingCode(parts[0]!, parts[3] || null);
      collected.push({
        code: "E050",
        severity: "ERROR",
        message: `Rows ${rowNums.join(", ")}: duplicate within file — same creative \`'${shown}'\`, campaign \`'${parts[1]}'\`, platform \`${platform}\`, date \`${parts[2]}\`.`,
        rows: rowNums,
        value: shown,
      });
    }
  }

  // W004 — rounding is never silent. One line per field, in the canonical
  // field order, counting only the cells whose value actually CHANGED; a file
  // of whole numbers says nothing at all.
  for (const field of COUNT_FIELDS) {
    const n = roundedCells.get(field);
    if (!n) continue;
    warnings.push({
      code: "W004",
      severity: "WARNING",
      message:
        `${n} fractional ${n === 1 ? "value" : "values"} in \`'${field}'\` ${n === 1 ? "was" : "were"} rounded to the nearest whole number — ${FIELD_META[field].label} is stored as a whole count.` +
        // The why, where it IS the explanation: Google's data-driven
        // attribution splits one conversion across touchpoints.
        (field === "conversions"
          ? " Google's data-driven attribution reports conversions fractionally."
          : ""),
      field,
    });
  }

  // ---------- Stage 5 — already imported (blocking) ----------
  // Per (creative, platform, campaign, date), the stored rows' landing pages —
  // fetched in ONE lookup for the whole file.
  //  - The SAME landing page is a true duplicate → E051 (upsert updates it
  //    instead).
  //  - A DIFFERENT landing page stored for that day, which this file does not
  //    also carry, means the ad was renamed on the platform: platforms export
  //    a live ad's CURRENT name for every past day, so importing would count
  //    the day twice → E052, in BOTH modes. A file that carries both pages for
  //    the day is an A/B test, not a rename, and passes.
  if (input.findExisting && accepted.length > 0) {
    const dayKey = (parts: string[]) => parts.slice(0, 3).join("");
    const wanted = new Map<string, ExistingDayQuery>();
    for (const [k, rowNums] of seenKeys) {
      if (rowNums.length > 1) continue; // already reported as E050
      const parts = k.split("");
      wanted.set(dayKey(parts), {
        creativeName: parts[0]!,
        campaignName: parts[1]!,
        date: parts[2]!,
      });
    }
    const stored = new Map<string, ExistingRecord[]>();
    if (wanted.size > 0) {
      for (const r of await input.findExisting([...wanted.values()], platform)) {
        const dk = dayKey([r.creativeName, r.campaignName, r.date]);
        if (!wanted.has(dk)) continue; // over-returned by the lookup
        const list = stored.get(dk) ?? [];
        list.push(r);
        stored.set(dk, list);
      }
    }
    for (const [k, rowNums] of seenKeys) {
      if (rowNums.length > 1) continue; // already reported as E050
      const parts = k.split("");
      const [name, campaign, day] = [parts[0]!, parts[1]!, parts[2]!];
      const code = parts[3] || null;
      const existing = stored.get(dayKey(parts)) ?? [];
      const shown = withLandingCode(name, code);
      const same = existing.find((e) => e.landingCode === code);
      if (same) {
        if (!input.allowExisting) {
          collected.push({
            code: "E051",
            severity: "ERROR",
            message: `Row(s) ${rowNums.join(", ")}: \`'${shown}'\` / campaign \`'${campaign}'\` on \`${platform}\` for \`${day}\` was already imported (batch ${same.batchId}). Roll back that batch to re-import.`,
            rows: rowNums,
            value: shown,
          });
        }
        continue;
      }
      const carried = fileDayCodes.get(dayKey(parts)) ?? new Set<string>();
      const renamed = existing.find((e) => !carried.has(e.landingCode ?? ""));
      if (renamed) {
        collected.push({
          code: "E052",
          severity: "ERROR",
          message: `Row(s) ${rowNums.join(", ")}: \`'${shown}'\` / campaign \`'${campaign}'\` on \`${platform}\` for \`${day}\` was already imported under a different landing page (\`'${withLandingCode(name, renamed.landingCode)}'\`, batch ${renamed.batchId}). The ad was renamed on the platform after that day was imported — upload only the days after the rename.`,
          rows: rowNums,
          value: shown,
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
function parseDate(raw: string, formats: DateFormat[]): string | null {
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
