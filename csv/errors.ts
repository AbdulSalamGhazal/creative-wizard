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
  W001: "WARNING",
  W002: "WARNING",
  // W003: a row matches (creative, platform, date) already imported in an
  // earlier upload. Non-blocking — the same creative can recur across
  // campaigns; we warn so an accidental re-upload doesn't silently double-count.
  W003: "WARNING",
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
