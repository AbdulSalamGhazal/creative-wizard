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
  // E060: a campaign name in this file already exists on a DIFFERENT platform.
  // A campaign name must belong to one platform — the app treats the same name
  // as one campaign, so allowing it on two platforms would silently merge them.
  E060: "ERROR",
  // E061: the campaign isn't registered. Like creatives (E020), a campaign must
  // be created in the system before an upload can reference it — otherwise a
  // rename at the source would silently spawn a new campaign.
  E061: "ERROR",
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
