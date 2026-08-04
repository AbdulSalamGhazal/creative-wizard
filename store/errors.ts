/**
 * Store-order upload error catalog — the SECOND catalog in the app (the ads
 * pipeline has its own in `csv/errors.ts`). Codes are S-prefixed and grouped by
 * band: S00x file integrity, S01x header mapping, S02x-S04x per-field, S05x
 * duplicates/already-imported, S06x info. Same structure as the ads taxonomy
 * (code → severity, fully-rendered message per site) but a distinct namespace.
 */

export const storeErrorCodes = {
  S001: "FATAL", // file too large
  S002: "FATAL", // unparseable file
  S003: "FATAL", // no data rows
  S004: "FATAL", // bad encoding
  S010: "FATAL", // required field's accepted header absent from the file
  S011: "FATAL", // duplicate header in the file
  S020: "ERROR", // order_id blank
  S030: "ERROR", // order_date invalid / unparseable
  S040: "ERROR", // total_amount not numeric
  S042: "ERROR", // required custom field missing a value
  S043: "ERROR", // custom field wrong type (number/date)
  S050: "ERROR", // duplicate order_id within the file
  S051: "ERROR", // order_id already imported (strict, non-upsert mode)
  S060: "WARNING", // file column ignored (no field maps to it)
} as const;

export type StoreErrorCode = keyof typeof storeErrorCodes;
export type StoreSeverity = (typeof storeErrorCodes)[StoreErrorCode];

export interface StoreValidationError {
  code: StoreErrorCode;
  severity: StoreSeverity;
  /** Fully-rendered, human-readable — row numbers/values baked in. */
  message: string;
  row?: number;
  rows?: number[];
  field?: string;
  value?: string;
}

/** Build an error, stamping the severity from the catalog. */
export function err(
  code: StoreErrorCode,
  message: string,
  extra?: Omit<StoreValidationError, "code" | "severity" | "message">,
): StoreValidationError {
  return { code, severity: storeErrorCodes[code], message, ...extra };
}

export const SEVERITY_LABEL: Record<StoreSeverity, string> = {
  FATAL: "Fatal",
  ERROR: "Error",
  WARNING: "Warning",
};
