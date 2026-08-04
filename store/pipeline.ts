import { err, type StoreValidationError } from "./errors";
import { parseStoreFile, parseStoreDate, parseStoreNumber } from "./parse";
import type { StoreField } from "./fields";

/**
 * Store-order validation pipeline — the parallel of `csv/pipeline.ts`, but with
 * EXPLICIT config-driven mapping (accepted headers from `store_order_fields`),
 * the three core fields, and per-type custom-field rules. Stages 1-2 fail fast
 * (parse / header mapping); stage 3 collects EVERY row error. All-or-nothing:
 * a non-empty error list rejects the whole file (nothing is written).
 */

export interface StorePipelineInput {
  content: ArrayBuffer | Uint8Array | string;
  byteLength?: number;
  fileName?: string;
  /** Field config (core + custom), any order. */
  fields: StoreField[];
  /** order_ids already in the DB for this account (for strict-reject / upsert split). */
  existingOrderIds: Set<string>;
  /** false → strict insert (existing id = row error); true → update existing, insert new. */
  upsert: boolean;
}

export interface StoreParsedRow {
  rowNumber: number;
  orderId: string;
  orderDate: string; // YYYY-MM-DD
  totalAmount: string; // fixed(2) numeric string for numeric(12,2)
  /** Custom-field values keyed by field key (typed: number | string). */
  attributes: Record<string, string | number>;
  /** upsert: true = this order exists and will be UPDATED; false = INSERT. */
  isUpdate: boolean;
}

export type StorePipelineResult =
  | {
      ok: true;
      rows: StoreParsedRow[];
      newCount: number;
      updatedCount: number;
      /** File columns that no field maps to (ignored, reported as info). */
      ignoredColumns: string[];
      warnings: StoreValidationError[];
    }
  | { ok: false; errors: StoreValidationError[]; warnings: StoreValidationError[] };

const norm = (s: string) => s.trim().toLowerCase();

export function runStorePipeline(input: StorePipelineInput): StorePipelineResult {
  const warnings: StoreValidationError[] = [];

  // ── Stage 1: parse (fail fast) ────────────────────────────────────────────
  const parsed = parseStoreFile({
    content: input.content,
    byteLength: input.byteLength,
    fileName: input.fileName,
  });
  if (!parsed.ok) return { ok: false, errors: [parsed.error], warnings };
  const { header, rows, rowNumbers } = parsed;

  // ── Stage 2: header mapping (fail fast) ───────────────────────────────────
  // Duplicate header in the file → ambiguous mapping.
  const seenHeaders = new Set<string>();
  for (const h of header) {
    const k = norm(h);
    if (!k) continue;
    if (seenHeaders.has(k)) {
      return {
        ok: false,
        errors: [err("S011", `Duplicate column header in the file: \`${h}\`.`)],
        warnings,
      };
    }
    seenHeaders.add(k);
  }
  const headerLookup = new Map<string, number>();
  header.forEach((h, i) => {
    const k = norm(h);
    if (k && !headerLookup.has(k)) headerLookup.set(k, i);
  });

  const fieldIndex = new Map<string, number>(); // field key → column index
  const usedColumns = new Set<number>();
  const missing: StoreValidationError[] = [];

  for (const field of input.fields) {
    let colIndex: number | undefined;
    for (const accepted of field.headers) {
      const idx = headerLookup.get(norm(accepted));
      if (idx !== undefined) {
        colIndex = idx;
        break;
      }
    }
    if (colIndex === undefined) {
      if (field.required) {
        const wanted =
          field.headers.length > 0
            ? field.headers.map((h) => `\`${h}\``).join(" / ")
            : "(no accepted headers configured — set one in Configuration → Store fields)";
        missing.push(
          err(
            "S010",
            `Required field "${field.label}" has no matching column. Expected header: ${wanted}.`,
            { field: field.key },
          ),
        );
      }
      continue;
    }
    fieldIndex.set(field.key, colIndex);
    usedColumns.add(colIndex);
  }
  if (missing.length > 0) return { ok: false, errors: missing, warnings };

  // Unmapped file columns → ignored (info).
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    if (h.trim() && !usedColumns.has(i)) {
      ignoredColumns.push(h);
      warnings.push(err("S060", `Column ignored (no field maps to it): \`${h}\`.`));
    }
  });

  const cell = (row: string[], key: string): string => {
    const idx = fieldIndex.get(key);
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };
  const customFields = input.fields.filter(
    (f) => !f.core && fieldIndex.has(f.key),
  );

  // ── Stage 3: per-row validation (collect all) ─────────────────────────────
  const errors: StoreValidationError[] = [];
  const accepted: StoreParsedRow[] = [];
  const idToRows = new Map<string, number[]>(); // for intra-file dup detection

  rows.forEach((row, i) => {
    const rowNumber = rowNumbers[i]!;

    const orderId = cell(row, "order_id");
    if (!orderId) {
      errors.push(err("S020", `Row ${rowNumber}: order_id is blank.`, { row: rowNumber }));
    } else {
      const arr = idToRows.get(orderId);
      if (arr) arr.push(rowNumber);
      else idToRows.set(orderId, [rowNumber]);
    }

    const rawDate = cell(row, "order_date");
    const orderDate = parseStoreDate(rawDate);
    if (!orderDate) {
      errors.push(
        err("S030", `Row ${rowNumber}: order_date \`${rawDate}\` is not a valid date (YYYY-MM-DD).`, {
          row: rowNumber,
          value: rawDate,
        }),
      );
    }

    const rawAmount = cell(row, "total_amount");
    const amount = parseStoreNumber(rawAmount);
    if (amount === null) {
      errors.push(
        err("S040", `Row ${rowNumber}: total_amount \`${rawAmount}\` is not a number.`, {
          row: rowNumber,
          value: rawAmount,
        }),
      );
    }

    // Custom fields.
    const attributes: Record<string, string | number> = {};
    for (const f of customFields) {
      const raw = cell(row, f.key);
      if (!raw) {
        if (f.required) {
          errors.push(
            err("S042", `Row ${rowNumber}: required field "${f.label}" is blank.`, {
              row: rowNumber,
              field: f.key,
            }),
          );
        }
        continue;
      }
      if (f.type === "number") {
        const n = parseStoreNumber(raw);
        if (n === null) {
          errors.push(
            err("S043", `Row ${rowNumber}: "${f.label}" \`${raw}\` is not a number.`, {
              row: rowNumber,
              field: f.key,
              value: raw,
            }),
          );
        } else {
          attributes[f.key] = n;
        }
      } else if (f.type === "date") {
        const d = parseStoreDate(raw);
        if (!d) {
          errors.push(
            err("S043", `Row ${rowNumber}: "${f.label}" \`${raw}\` is not a valid date.`, {
              row: rowNumber,
              field: f.key,
              value: raw,
            }),
          );
        } else {
          attributes[f.key] = d;
        }
      } else {
        attributes[f.key] = raw;
      }
    }

    // Keep the candidate row even if it has errors; the final gate rejects the
    // whole file if `errors` is non-empty, so we never emit a partial commit.
    accepted.push({
      rowNumber,
      orderId,
      orderDate: orderDate ?? "",
      totalAmount: amount === null ? "0" : amount.toFixed(2),
      attributes,
      isUpdate: false, // set below
    });
  });

  // ── Stage 4: intra-file duplicates ────────────────────────────────────────
  for (const [orderId, rowNums] of idToRows) {
    if (rowNums.length > 1) {
      errors.push(
        err("S050", `Rows ${rowNums.join(", ")}: duplicate order_id \`${orderId}\` within the file.`, {
          rows: rowNums,
          value: orderId,
        }),
      );
    }
  }

  // ── Stage 5: existing ids (strict reject / upsert split) ──────────────────
  let newCount = 0;
  let updatedCount = 0;
  for (const r of accepted) {
    if (!r.orderId) continue;
    const exists = input.existingOrderIds.has(r.orderId);
    if (exists && !input.upsert) {
      errors.push(
        err("S051", `Row ${r.rowNumber}: order_id \`${r.orderId}\` is already imported. Enable upsert to update it.`, {
          row: r.rowNumber,
          value: r.orderId,
        }),
      );
    } else if (exists) {
      r.isUpdate = true;
      updatedCount++;
    } else {
      newCount++;
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, rows: accepted, newCount, updatedCount, ignoredColumns, warnings };
}
