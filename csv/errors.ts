/**
 * CSV validation error taxonomy.
 *
 * Codes are stable across releases. See docs/validation-spec.md §7 for the
 * canonical templates and examples.
 */

export const errorCodes = {
  E001: "FATAL",
  E002: "FATAL",
  E003: "FATAL",
  E004: "FATAL",
  E010: "FATAL",
  E012: "FATAL",
  E020: "ERROR",
  E021: "ERROR",
  E030: "ERROR",
  E031: "ERROR",
  E040: "ERROR",
  E041: "ERROR",
  E042: "ERROR",
  // E050: duplicate within the uploaded file (same creative + campaign + date).
  // E051: row matches (creative, platform, campaign, date) already imported.
  // Campaign name is part of the key, so legitimate multi-campaign rows are
  // distinct and allowed; only true duplicates are rejected.
  E050: "ERROR",
  E051: "ERROR",
  // Bulk-update only:
  // E060: a row's identity (creative, platform, campaign, date) matches no
  //       existing record — bulk update can only touch records that exist.
  // E061: the file includes no value column to update (schema-level).
  // E062: a value column you included has a blank cell — bulk update requires
  //       a real value so it can't accidentally wipe a metric.
  E060: "ERROR",
  E061: "FATAL",
  E062: "ERROR",
  W001: "WARNING",
  W002: "WARNING",
} as const;

export type ErrorCode = keyof typeof errorCodes;
export type Severity = (typeof errorCodes)[ErrorCode];

export interface ValidationError {
  code: ErrorCode;
  severity: Severity;
  message: string;
  row?: number;
  rows?: number[];
  field?: string;
  value?: string;
}
