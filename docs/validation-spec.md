# Urjwan Creative Management System — Validation Specification

**Version:** 1.2
**Owner:** Salam — Urjwan
**Related document:** `urjwan-ccms-prd.md`
**Status:** Live — updated 2026-07 to document production behavior (upsert mode,
XLSX ingestion, the campaign registry / E060 / E061, and the encoding decision).
v1.2 blesses the implemented **trim-then-exact** creative-name matching and the
**blank-numeric-cell → 0** rule as the intended contract (see §4 / §5.1); the
prior "known divergence" is now a settled decision, not a bug.
Per-platform header mappings are DB-driven (`/admin/catalog?tab=mappings`), so
§9's static tables are historical.

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
4. **Idempotent.** A record is uniquely keyed by `(creative, platform, campaign, date)`, where the campaign is resolved through the campaigns **registry** (stored as a `campaign_id` FK — see §4.1). The same creative can run in multiple campaigns on the same day (distinct keys → allowed), but re-uploading the *same* campaign's day is rejected as a duplicate — no silent double-counting. (Upsert mode deliberately relaxes this — see §8.1.)
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
| 4     | Intra-file dupes | Collect errors  | Continue collecting from stage 5; report at end. |
| 5     | Database dupes   | Collect errors  | Report at end. |

### 3.1 Stage 1 — File integrity

- File size ≤ 10 MB (E001)
- File parses as CSV (E002)
- File is not empty after stripping headers and blank rows (E003)
- File encoding must be UTF-8 (E004). *(v1.1 decision: the Windows-1256
  fallback originally planned here was never implemented and is formally
  dropped; the W001 code stays reserved but unused. Exports from all four
  platforms are UTF-8 in practice.)*
- **XLSX ingestion:** `.xlsx` files are accepted alongside `.csv`. The first
  sheet is converted in-memory (dates read as real Date cells) and then flows
  through the identical pipeline — every rule below applies unchanged.

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
- Campaign (+ ad set) resolves to a **registered campaign** for this account
  (E061) — like creatives, a campaign must be created in the system before an
  upload can reference it, otherwise a rename at the source would silently
  spawn a new campaign
- The campaign name must not already belong to a **different platform** (E060)
  — one campaign = one platform; allowing the same name on two platforms would
  silently merge them (Instagram/Facebook stay distinct via the name tag, §4.1)

### 3.4 Stage 4 — Intra-file duplicates

Rows are keyed by `(creative_name, campaign_name, date)` (platform is constant per file). Two rows that share a key are a duplicate within the file → **E050** (reported once, listing the row numbers). Different campaigns are distinct keys, so a creative running in several campaigns on the same day is allowed.

### 3.5 Stage 5 — Database duplicates

Each distinct `(creative_name, platform, campaign_name, date)` from the file is checked against existing data:

- If a record already exists for that key → **E051** (blocking), naming the existing batch so the user can roll it back and re-import.
- The database enforces this with a unique index on `(creative_id, platform, campaign_id, date)` — the campaign name from the file is resolved to its registry row's id at commit time.

---

## 4. Creative-Name Matching Rules

Matching is **trim-then-exact** (2026-07 decision):

- **Whitespace is trimmed** off every cell — including the creative name — before matching. `URJ_VID_001 ` (trailing space) and `URJ_VID_001` match.
- After the trim, the match is **byte-exact**: **case-sensitive** (`URJ_VID_001` and `urj_vid_001` are different names) and with **no Unicode normalization** on either side — the stored library name and the CSV cell must be byte-identical once trimmed.
- A name that doesn't match a registered creative → **E020** (not registered). An empty creative-name cell → **E021**.
- No fuzzy matching, no "did you mean" suggestions.

The trim-then-exact rule is intentional: trailing/leading whitespace in a platform export is a formatting artifact, not a naming choice, so forgiving it removes a whole class of false mismatches — while case- and character-exactness still push the team to maintain naming discipline at the source. This is the settled contract; do **not** re-tighten it to strict-with-NFC.

> A "did you mean" hint based on Levenshtein distance is a nice-to-have for a later version, after the team has lived with the exact-match version for a while.

### 4.1 Campaign identity & the registry

The stored campaign name is built ONLY through `buildCampaignName()`
(`lib/campaign.ts`): `Campaign ➤ Adset`, with a short platform tag appended
for the two Meta channels — `(IG)` for Instagram, `(FB)` for Facebook — so the
same Meta campaign split across the two stays distinct. Uploads must reference
a campaign already registered in the system (`/campaigns/new` or the edit
dialog); unregistered → E061, registered on another platform → E060. The perf
row stores the registry row's `campaign_id` (uuid FK), so renaming a campaign
is a single registry update — historical rows follow automatically.

---

## 5. Field Validation Rules

### 5.1 Numeric fields

Applies to: `spend`, `impressions`, `clicks`, `conversions`, `conversion_value`, `video_views_3s`, `video_views_15s`.

- Must parse as a number.
- Comma thousand separators are accepted: `"1,234.56"` parses as `1234.56`.
- Currency symbols and trailing unit strings are stripped: `"$1,234"`, `"1234 USD"` parse to `1234`.
- Decimal point only as the decimal separator (no European comma-as-decimal in v1; flagged as future work if any platform exports that way).
- **Negative values are rejected** (E041). Refunds, adjustments, and credits are out of scope for v1.
- Empty values and the empty markers `"-"`, `"—"`, `"N/A"`, `"null"` (case-insensitive, trimmed) are treated as `0` in **every** numeric column — optional *and* required. A day with no conversions is a real, valid row, so a blank numeric cell never fails a row. A **required** numeric field is only enforced at the header stage: if its COLUMN is absent from the mapping the file is rejected with **E010** (`Required column missing`, §3.2) — never per-cell E042.
- `impressions` and `clicks` are stored as integers; decimal values are accepted and floored (some platforms export `1234.0`).

### 5.2 Date field

- Must parse to a valid calendar date.
- ISO 8601 (`YYYY-MM-DD`) is canonical; per-platform accepted formats are documented in §9.
- Dates more than 24 hours in the future are rejected (E031).
- No lower bound — historical backfill is explicitly supported per the PRD.

### 5.3 Creative-name field

- Required, non-empty (an empty cell → E021).
- **Trimmed**, then matched against the library **byte-exactly** — case-sensitive, no case folding, no Unicode normalization. See §4.

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
| E042  | ERROR    | Row {n}: required field `'{field}'` is missing. *(Identity fields only — `date`, `campaign_name`, `adset_name`. A blank numeric cell is `0`, never E042; a missing required column is E010.)* | "Row 88: required field `'campaign_name'` is missing." |
| E050  | ERROR    | Rows {rows}: duplicate within file — same creative `'{name}'`, campaign `'{campaign}'`, platform `{platform}`, date `{date}`. | — |
| E051  | ERROR    | Row(s) {rows}: `'{name}'` / campaign `'{campaign}'` on `{platform}` for `{date}` was already imported (batch {id}).         | — |
| E060  | ERROR    | Campaign `'{name}'` already exists on `{platform}` — one campaign belongs to one platform.                | "Campaign `'Summer ➤ Broad'` already exists on tiktok."                                                       |
| E061  | ERROR    | Row {n}: campaign `'{name}'` is not registered. Register it before importing.                             | —                                                                                                             |
| W001  | WARNING  | *(reserved — the Windows-1256 fallback was never implemented; see §3.1)*                                  | —                                                                                                             |
| W002  | WARNING  | Unknown column ignored: `{column}`.                                                                       | "Unknown column ignored: `Custom note`."                                                                      |

The error report rendered to the user is a virtualized list (scrollable, copy-pasteable, exportable as CSV) so that files with hundreds of errors remain reviewable.

---

## 8. Re-upload & Rollback Behavior

- An admin can roll back any upload batch within 24 hours of its creation.
- Rollback deletes all `performance_records` rows attached to that batch.
- Re-uploading a file that overlaps existing data is **rejected** row-by-row
  with E051 (strict mode). To replace a batch uploaded by mistake, roll the
  batch back first and re-import — or use **upsert mode** (§8.1) when the goal
  is updating existing days in place.
- Rollback is logged on the `upload_batches` row with the reverting user and timestamp.
- Beyond 24 hours, batches cannot be rolled back via the UI — an admin must operate on the database directly. This trade-off favors data safety over convenience.

### 8.1 Upsert mode (v1.1)

The New-upload form has an **upsert** toggle, built for TikTok-style rolling
attribution backfill (re-upload the same window daily; old days gain their
late-attributed conversions, the newest day is inserted):

- Runs the **same full validation pipeline**, but **skips the E051 check**.
- Validated rows are partitioned against the unique identity
  `(creative, platform, campaign, date)`: **new** rows are inserted under a
  fresh batch; **existing** rows are UPDATEd in place (full row,
  last-value-wins on every metric column; identity, batch ownership and
  exclusion flags untouched).
- Because it reuses the import validation, the file must carry **all mapped
  columns** (a full export) — partial files don't validate.
- In-place updates are **not rollback-able**: batch rollback only removes the
  rows the batch inserted. A pure-update upsert creates no batch at all.
- Audit: `upload.commit` with `{rowsImported, rowsUpdated, upsert: true}`.

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
