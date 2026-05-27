# Urjwan Creative Management System — Validation Specification

**Version:** 1.0 (Draft)
**Owner:** Salam — Urjwan
**Related document:** `urjwan-ccms-prd.md`
**Status:** Skeleton complete; per-platform schemas (§9) pending real CSV samples

---

## 1. Purpose & Scope

This document defines exactly what makes an uploaded CSV file "valid." It covers every check the system performs, every error it can produce, and the wording of every message the user can see.

The validation layer is the seam between messy real-world platform exports and the system's clean internal data model. It is the most user-facing module in the system — if it is sharp, clear, and forgiving in the right ways, the whole product feels solid; if not, the team will resent every upload.

This spec is the contract between the product (what the team expects when they upload) and the implementation (what Claude Code will build).

---

## 2. General Principles

The validation layer obeys these rules without exception:

1. **All-or-nothing.** A single error rejects the entire file. No partial imports, no "import what you can."
2. **Collect all errors.** Validation does not stop at the first row-level error. Every problem in the file is surfaced in one report.
3. **Deterministic.** The same input file produces the same result every time.
4. **Idempotent.** Re-uploading the same accepted file twice produces an obvious duplicate-batch error, not silent double-counting.
5. **Read-only until success.** Nothing is written to the database until validation passes end-to-end and the user confirms import.
6. **Never modifies the input.** The original CSV file is preserved as uploaded; transformations happen on parsed in-memory data.

Some checks produce **warnings** (e.g. encoding fallback, unknown columns ignored). Warnings do not block import — they appear in the post-import summary or alongside other findings.

---

## 3. Validation Pipeline

Validation runs as a five-stage pipeline. The first two stages are **fail-fast** — if they fail, the file cannot be processed further. Stages 3–5 are **error-collecting** — all errors found across them are reported together.

| Stage | Name             | Behavior        | If failed                                              |
| ----- | ---------------- | --------------- | ------------------------------------------------------ |
| 1     | File integrity   | Fail-fast       | Return single error; cannot proceed.                   |
| 2     | Schema           | Fail-fast       | Return schema errors; cannot proceed to row checks.    |
| 3     | Row content      | Collect errors  | Continue collecting from stages 4 and 5; report at end. |
| 4     | Intra-file dupes | Collect errors  | Continue collecting from stage 5; report at end.        |
| 5     | Database dupes   | Collect errors  | Report at end.                                          |

### 3.1 Stage 1 — File integrity

- File size ≤ 10 MB (E001)
- File parses as CSV (E002)
- File is not empty after stripping headers and blank rows (E003)
- File encoding is UTF-8 or Windows-1256 (E004). UTF-8 is tried first; on failure, Windows-1256 is attempted with a non-blocking warning (W001).

### 3.2 Stage 2 — Schema

- All required headers for the selected platform are present (E010).
- Headers are matched **case-insensitively** and after trimming whitespace. Platform exports are inconsistent here, but headers come from the platform — not from a user — so leniency is safe.
- Unknown extra columns are allowed and ignored (warning W002).
- Duplicate header columns are rejected (E012) — ambiguity is not tolerated.

### 3.3 Stage 3 — Row content

For each row, the following are checked **independently** (one row can produce multiple errors):

- All required fields present (E042)
- Numeric fields parse and are non-negative (E040, E041)
- Date field parses and is not in the future (E030, E031)
- Creative-name field is non-empty (E021)
- Creative-name field matches a registered name in the library (E020)

### 3.4 Stage 4 — Intra-file duplicates

After all rows have been individually validated, the system checks for duplicates **within the file itself**:

- For every group of rows with the same `(creative_name, platform, date)`, report E050.
- Each duplicate group is reported once, listing all the row numbers involved.

### 3.5 Stage 5 — Database duplicates

Finally, the system checks each unique `(creative_name, platform, date)` from the file against existing data in the database:

- If a record already exists for that combination → E051, naming the existing batch ID so the user can roll it back if desired.

---

## 4. Creative-Name Matching Rules

Matching is **strict**:

- Exact byte match after UTF-8 NFC normalization.
- **Case-sensitive.** `URJ_VID_001` and `urj_vid_001` are different names.
- **No whitespace forgiveness.** `URJ_VID_001 ` (trailing space) and `URJ_VID_001` are different names.
- No fuzzy matching, no "did you mean" suggestions in v1.

The strictness is intentional: it makes the system's behavior fully predictable and pushes the team to maintain naming discipline at the source. Forgiveness here would hide problems rather than fix them.

> A "did you mean" hint based on Levenshtein distance is a nice-to-have for v1.1, after the team has lived with the strict version for a while.

---

## 5. Field Validation Rules

### 5.1 Numeric fields

Applies to: `spend`, `impressions`, `clicks`, `conversions`, `conversion_value`, `video_views_3s`, `video_views_15s`.

- Must parse as a number.
- Comma thousand separators are accepted: `"1,234.56"` parses as `1234.56`.
- Currency symbols and trailing unit strings are stripped: `"$1,234"`, `"1234 USD"` parse to `1234`.
- Decimal point only as the decimal separator (no European comma-as-decimal in v1; flagged as future work if any platform exports that way).
- **Negative values are rejected** (E041). Refunds, adjustments, and credits are out of scope for v1.
- Empty values, `"-"`, `"—"`, `"N/A"`, `"null"` are treated as `0` for **optional** fields and rejected as missing (E042) for **required** fields.
- `impressions` and `clicks` are stored as integers; decimal values are accepted and floored (some platforms export `1234.0`).

### 5.2 Date field

- Must parse to a valid calendar date.
- ISO 8601 (`YYYY-MM-DD`) is canonical; per-platform accepted formats are documented in §9.
- Dates more than 24 hours in the future are rejected (E031).
- No lower bound — historical backfill is explicitly supported per the PRD.

### 5.3 Creative-name field

- Required, non-empty.
- Matched against the library **exactly as it appears in the CSV cell** — no whitespace trimming, no case folding, no Unicode normalization beyond standard NFC. See §4.

---

## 6. Edge Cases & File Quirks

| Situation                                                 | Behavior                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Fully empty rows                                          | Silently skipped.                                                                       |
| Totals / subtotals row at the bottom (Meta exports these) | Detected and skipped if the row lacks a date or creative name. Documented per platform. |
| BOM character at the start of the file                    | Stripped silently.                                                                      |
| Semicolon delimiter instead of comma                      | Detected automatically: if the header row contains no commas, semicolon is used.        |
| Trailing empty columns                                    | Ignored.                                                                                |
| Quote-wrapped fields containing commas                    | Handled per RFC 4180.                                                                   |
| Mixed line endings (CRLF / LF)                            | Normalized at parse time.                                                               |

---

## 7. Error Taxonomy

Every error carries a stable code, a severity, a template, and an example. Codes are stable across releases so the team builds muscle memory.

**Severity:**
- `FATAL` — pipeline cannot continue; only this error is reported.
- `ERROR` — collected and reported alongside other errors at the end.
- `WARNING` — non-blocking; shown in the post-import summary.

| Code  | Severity | Template                                                                                                  | Example                                                                                                       |
| ----- | -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| E001  | FATAL    | File exceeds the 10 MB upload limit.                                                                      | —                                                                                                             |
| E002  | FATAL    | The file could not be parsed as CSV.                                                                      | —                                                                                                             |
| E003  | FATAL    | The file contains no data rows.                                                                           | —                                                                                                             |
| E004  | FATAL    | The file encoding is not supported. Save as UTF-8 and re-upload.                                          | —                                                                                                             |
| E010  | FATAL    | Required column missing: `{column}`.                                                                      | "Required column missing: `Amount spent (USD)`."                                                              |
| E012  | FATAL    | Duplicate header column: `{column}`.                                                                      | "Duplicate header column: `Impressions`."                                                                     |
| E020  | ERROR    | Row {n}: creative `'{name}'` is not registered in the library.                                            | "Row 47: creative `'URJ_VID_023'` is not registered in the library."                                          |
| E021  | ERROR    | Row {n}: creative name is empty.                                                                          | —                                                                                                             |
| E030  | ERROR    | Row {n}: invalid date `'{value}'`.                                                                        | "Row 12: invalid date `'31/13/2026'`."                                                                        |
| E031  | ERROR    | Row {n}: date `'{value}'` is in the future.                                                               | "Row 12: date `'2027-01-01'` is in the future."                                                               |
| E040  | ERROR    | Row {n}: `'{field}'` is not a valid number (`'{value}'`).                                                 | "Row 88: `'Spend'` is not a valid number (`'twelve'`)."                                                       |
| E041  | ERROR    | Row {n}: `'{field}'` must be non-negative (got `{value}`).                                                | "Row 88: `'Spend'` must be non-negative (got `-12.45`)."                                                      |
| E042  | ERROR    | Row {n}: required field `'{field}'` is missing.                                                           | "Row 88: required field `'Impressions'` is missing."                                                          |
| E050  | ERROR    | Rows {n1}, {n2}: duplicate within file — same creative `'{name}'`, platform `{platform}`, date `{date}`. | "Rows 12, 47: duplicate within file — same creative `'URJ_VID_011'`, platform `TikTok`, date `2026-05-22`." |
| E051  | ERROR    | Row {n}: data for `'{name}'` on `{platform}` for `{date}` already exists (upload batch #{batch_id}).     | "Row 12: data for `'URJ_VID_011'` on `TikTok` for `2026-05-22` already exists (upload batch #87)."            |
| W001  | WARNING  | File was decoded as Windows-1256 (not UTF-8). Future uploads should be UTF-8.                            | —                                                                                                             |
| W002  | WARNING  | Unknown column ignored: `{column}`.                                                                       | "Unknown column ignored: `Custom note`."                                                                      |

The error report rendered to the user is a virtualized list (scrollable, copy-pasteable, exportable as CSV) so that files with hundreds of errors remain reviewable.

---

## 8. Re-upload & Rollback Behavior

- An admin can roll back any upload batch within 24 hours of its creation.
- Rollback deletes all `PerformanceRecord` rows attached to that batch.
- After rollback, the same file can be re-uploaded without triggering E051 conflicts.
- Rollback is logged on the `UploadBatch` row with the reverting user and timestamp.
- Beyond 24 hours, batches cannot be rolled back via the UI — an admin must operate on the database directly. This trade-off favors data safety over convenience.

---

## 9. Per-Platform Schemas

> **Pending real CSV samples.** Each section below will be populated from an actual export.

### 9.1 Meta (Facebook / Instagram Ads)

| Internal field    | Meta column header (TBD) | Type   | Required |
| ----------------- | ------------------------ | ------ | -------- |
| creative_name     | TBD                      | string | Yes      |
| date              | TBD                      | date   | Yes      |
| spend             | TBD                      | number | Yes      |
| impressions       | TBD                      | number | Yes      |
| clicks            | TBD                      | number | Yes      |
| conversions       | TBD                      | number | No       |
| conversion_value  | TBD                      | number | No       |
| video_views_3s    | TBD                      | number | No       |
| video_views_15s   | TBD                      | number | No       |

**Quirks to document:** subtotal row at the bottom, currency suffix in column names, accepted date formats, breakdown columns.

### 9.2 TikTok Ads

Same template as 9.1 — pending sample.

### 9.3 Snapchat Ads

Same template as 9.1 — pending sample.

### 9.4 Google / YouTube Ads

Same template as 9.1 — pending sample.

---

## 10. Performance Budget

- Files up to 10 MB / ~50,000 rows complete the full pipeline (stages 1–5) in **under 10 seconds**.
- The error report UI renders even for files with thousands of errors via list virtualization.
- Database duplicate-checking (stage 5) uses a single indexed query per file, not per row.

---

## 11. What This Spec Does Not Cover

- Authentication and authorization checks (covered in tech spec).
- The visual design of the upload modal and error report (covered later in design artifacts).
- The exact wording of post-import success summaries (a UX detail finalized during build).
- Historical migration tooling (a separate spec if it becomes needed).
