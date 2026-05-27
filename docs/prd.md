# Urjwan Creative Management System — Product Requirements Document

**Version:** 1.2 (Revised)
**Owner:** Salam — Urjwan
**Status:** Ready for technical specification

---

## 1. Overview

The Urjwan Creative Management System (CCMS) is an internal web application for centralized tracking, organization, and performance analysis of advertising creatives across paid social and search channels.

It replaces the existing "Creative Wizard" spreadsheet workflow with a multi-user, database-backed system featuring daily CSV ingestion, a structured creative library with product attribution, and a polished, highly interactive analytics dashboard.

The system serves the Urjwan marketing team — managing campaigns across **Meta, TikTok, Snapchat, and Google/YouTube** — by providing a single source of truth for which creatives are running, which products they promote, what they've cost, and how they've performed over time.

---

## 2. Goals

- **G1.** Reduce manual reporting time from hours per week to minutes by automating CSV ingestion and aggregation.
- **G2.** Enable creative performance comparisons across platforms, dates, tags, and **products** through a unified, best-in-class analytics dashboard.
- **G3.** Centralize creative metadata (product, thumbnail, tags, notes) alongside performance data so the team can decide what to scale, kill, or iterate on without leaving the tool.
- **G4.** Enforce strict data integrity — every row in every upload must reference a registered creative, with no exceptions, no silent stubs, no partial imports.
- **G5.** Deliver a visually impressive, fluid analytical experience the team enjoys using daily.
- **G6.** Compute every aggregated and blended metric correctly — weighted by component sum, never an average of per-row ratios — with explicit support for excluding anomalous data points from aggregates.

---

## 3. Users & Roles

Authenticated access via **Google Workspace SSO**, restricted to the Urjwan workspace domain.

| Role       | Permissions                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Admin**  | Full access. Manage users, manage products, delete data, edit any record, upload CSVs, roll back uploads, exclude records. |
| **Editor** | Upload CSVs, create/edit creatives, manage tags, view all analytics. Default role for team members.                       |
| **Viewer** | (Future, not v1) Read-only access to dashboards.                                                                           |

The first user (Salam) is bootstrapped as Admin. Admin invites additional users by email.

---

## 4. Creative Identification

Each creative is identified by its **name** — a single canonical string defined by the Urjwan team according to their own naming convention (managed outside the system).

The system's responsibility is **matching**, not naming: when a CSV is uploaded, the system reads the creative-name field on each row and matches it against the names registered in the creative library.

**No naming format is enforced by the system.** The team is responsible for using consistent names across all ad platforms and inside the library.

If any row in an uploaded CSV references a name that is not registered in the library, **the entire file is rejected** (see §5.3).

Every creative is also attributed to exactly one **product** from the product library (see §5.2). Product attribution is required at creative creation.

---

## 5. Functional Requirements

### 5.1 Creative Library

A persistent registry of every creative the team launches.

**Each creative record stores (initial attribute set — to be revisited):**

- `name` — unique, the canonical identifier matched against CSV rows
- `product_id` — required, the product this creative promotes
- `type` — one of: `video`, `slides`, `image`
- `thumbnail_url` — manually uploaded image, max 2 MB
- `tags` — free-form, multi-select
- `notes` — rich text
- `status` — `draft` / `active` / `paused` / `archived`
- `launch_date`
- `created_by`, `created_at`, `updated_at`

> The Creative entity attribute set is not final — additional fields will be added during development as the team's needs sharpen.

**Library views:**

- **Grid view** with thumbnails (default)
- **Table view** with sortable columns
- **Filters:** product, type, status, tag, launch date, creator
- **Search:** by name, tag, or notes

**Creating creatives:**

- **Manual registration only.** Every creative must be created in the library before any CSV referencing it can be uploaded.
- A product must be selected during creation; creatives cannot be saved without one.
- There is **no auto-creation** of creatives from CSV uploads.

### 5.2 Product Library

A simple registry of the products Urjwan sells, used to attribute creatives.

**Each product record stores:**

- `id` (UUID)
- `name` — unique, human-readable
- `slug` — auto-generated from name, used in URLs and filter chips
- `status` — `active` / `archived`
- `created_by`, `created_at`, `updated_at`

**Management surface:**

- An `/admin/products` page (admin-only) for creating, renaming, and archiving products.
- Archived products remain attached to their existing creatives and historical records but are hidden from the "new creative" picker.
- Products cannot be hard-deleted while any creative references them (archive instead).

**Why a separate entity:** Products are referenced from many creatives and need their own management UX, naming consistency, and analytical filter. They are not just a tag.

### 5.3 CSV Upload & Validation

Daily ingestion of platform reports. Validation is **file-level and all-or-nothing**: a single error rejects the entire file with a clean, specific message. Nothing is committed until the file is fully clean.

Full behavior is defined in `urjwan-ccms-validation-spec.md`. Summary:

1. User selects platform from dropdown.
2. User uploads CSV file (max 10 MB).
3. System runs the 5-stage validation pipeline.
4. If any check fails → reject the file. Display a clean error report identifying every row that failed and the reason. No data is written.
5. If all checks pass → display a pre-import summary and confirm import.
6. On confirmation, data is committed and the upload batch is logged.

CSV uploads contain no product information — products live on the creative entity, so performance records inherit the product through the matched creative.

### 5.4 Analytics Dashboard

The analytical layer is the primary user-facing surface and must be **visually polished, dense without being cluttered, and fluid in interaction**. Charts are interactive — hover details, click-through to detail pages, zoom on time series, drill-downs from KPI tiles.

#### Pages

**A. Overview** (default landing page)

- KPI tiles: total spend, impressions, blended CTR, conversions, blended CPA, blended ROAS
- Spend over time — stacked area chart by platform
- Top 10 creatives by spend — table with sparklines
- Platform mix donut
- Product mix donut or breakdown panel

**B. Creative Detail Page** (per creative)

- Header: thumbnail, name, product, type, tags, status, launch date
- All-time KPIs across platforms
- Performance over time — multi-line chart, one line per platform
- Per-platform breakdown table
- **Excluded records panel** — list of records flagged as excluded, with the reason and toggle to re-include
- Editable notes panel

**C. Compare**

- Select 2–5 creatives → side-by-side comparison
- Metric selector (spend, impressions, CTR, CPM, conversions, ROAS, hook rate)
- Grouped chart + comparison table

**D. By Platform**

- Filter all dashboards to a single platform
- Surface platform-specific metrics (ThruPlays for Meta, 6 s views for TikTok, etc.)

#### Global filters (apply across all dashboard pages)

- Date range (presets: last 7 d / 30 d / 90 d / MTD / custom)
- **Products** (multi-select) — NEW
- Platforms (multi-select)
- Creative types (multi-select)
- Tags (multi-select)
- Status (multi-select)
- Excluded records — toggle to include them in the view (off by default)

#### Metric calculation rules

Every aggregated or blended metric is computed as a **weighted average via component sums** — never as a mean of per-row ratios. This is non-negotiable.

| Metric                       | Required | Computed as                                              |
| ---------------------------- | -------- | -------------------------------------------------------- |
| Spend                        | Yes      | `SUM(spend)`                                             |
| Impressions                  | Yes      | `SUM(impressions)`                                       |
| Clicks                       | Yes      | `SUM(clicks)`                                            |
| CTR (blended)                | Derived  | `SUM(clicks) / NULLIF(SUM(impressions), 0)`             |
| CPM (blended)                | Derived  | `SUM(spend) / NULLIF(SUM(impressions), 0) × 1000`        |
| CPC (blended)                | Derived  | `SUM(spend) / NULLIF(SUM(clicks), 0)`                    |
| Conversions                  | Optional | `SUM(conversions)`                                       |
| Conversion value             | Optional | `SUM(conversion_value)`                                  |
| ROAS (blended)               | Derived  | `SUM(conversion_value) / NULLIF(SUM(spend), 0)`         |
| CPA (blended)                | Derived  | `SUM(spend) / NULLIF(SUM(conversions), 0)`              |
| Hook rate (blended)          | Derived  | `SUM(video_views_3s) / NULLIF(SUM(impressions), 0)`     |
| Hold rate (blended)          | Derived  | `SUM(video_views_15s) / NULLIF(SUM(video_views_3s), 0)` |

All amounts are in **USD**.

All aggregations **exclude records flagged as anomalous** by default. The exclusion toggle reveals them; the math then includes everything.

#### Export

Every table view and chart has a **"Download CSV"** action. Exports respect the active global filters, including the exclusion toggle state.

### 5.5 Anomaly Exclusion

The team can flag individual performance records as anomalous to keep aggregated metrics honest when a platform misreports, a campaign accidentally double-fires, or a one-off promo distorts comparisons.

**Granularity:** the exclusion unit is a single `PerformanceRecord` — one `(creative, platform, date)` triple.

**Who can exclude:** Admin and Editor roles.

**Workflow:**

1. From the Creative Detail page or the relevant table, the user selects a record and clicks "Exclude from aggregates."
2. The system prompts for a short **reason** (free-form, required, 200 chars max).
3. The record is flagged with `excluded_from_aggregates = true`, the reason, the user, and a timestamp.
4. All blended/aggregated metrics across the system stop including this record immediately.
5. The record remains visible in detail views (with an "Excluded" badge) but is omitted from KPI tiles, charts, and table totals.

**Re-including:** any Admin or Editor can clear the exclusion flag. The history of exclusion events is preserved.

**Out of scope for v1:** automatic anomaly detection (Z-score, IQR, change-point detection). v1 is manual only. Auto-flagging can be layered on later without changing the data model.

> Rationale for the manual-first design: automated detection is opinionated and easy to get wrong on a young dataset. Manual exclusion is deterministic, auditable, and keeps the team in control. Once the system has months of clean data, an auto-flag layer can suggest exclusions for human approval.

---

## 6. Logical Data Model

```
User
  id, email, name, role, created_at

Product
  id, name (UNIQUE), slug (UNIQUE), status,
  created_by_user_id, created_at, updated_at

Creative
  id, name (UNIQUE), product_id, type, thumbnail_url,
  status, launch_date, notes, created_by_user_id,
  created_at, updated_at

CreativeTag
  creative_id, tag           -- composite key

UploadBatch
  id, platform, file_name, uploaded_by_user_id, uploaded_at,
  rows_imported, status,
  rolled_back_at, rolled_back_by_user_id

PerformanceRecord
  id, creative_id, platform, date,
  spend, impressions, clicks, conversions, conversion_value,
  video_views_3s, video_views_15s, raw_payload_jsonb,
  upload_batch_id, created_at,
  excluded_from_aggregates BOOLEAN DEFAULT false,
  excluded_reason TEXT,
  excluded_by_user_id, excluded_at
  UNIQUE(creative_id, platform, date)
```

`raw_payload_jsonb` stores the full original CSV row so platform-specific fields can be queried later without schema migrations.

> The schema is expected to evolve during development as the Creative attribute set is refined.

---

## 7. Non-Functional Requirements

- **Performance:** dashboard pages render in < 1.5 s for date ranges up to 90 days.
- **Security:** Google SSO with domain restriction; data encrypted at rest; thumbnails on a private bucket with signed URLs; CSRF protection on every write.
- **Reliability:** daily database backups; point-in-time recovery for 7 days.
- **Auditing:** every CSV upload, every write, and every exclusion event logged with user and timestamp.
- **Browser support:** latest two versions of Chrome, Safari, Edge. **Desktop-first**; tablet acceptable; mobile out of scope for v1.
- **Language:** UI in English.

---

## 8. Out of Scope (v1)

- Direct API integrations with ad platforms — defer to v2 once CSV workflow is validated.
- Additional platforms beyond the initial four.
- Mobile-optimized UI.
- Arabic UI localization.
- Automated anomaly detection (manual exclusion only in v1).
- Automated alerts / notifications.
- Public or external dashboard sharing.
- Multi-brand support (system is single-tenant: Urjwan only).
- Creative briefing / approval workflow.

---

## 9. Decisions & Resolved Questions

| #  | Question                              | Decision                                                                          |
| -- | ------------------------------------- | --------------------------------------------------------------------------------- |
| 1  | CSV column schemas                    | Mapped per platform to internal field names from real sample CSVs (in val. spec). |
| 2  | Currency                              | All monetary values in **USD**.                                                   |
| 3  | Platform count in v1                  | Stays at four: Meta, TikTok, Snapchat, Google/YouTube.                            |
| 4  | Thumbnail source                      | Manual upload only.                                                               |
| 5  | Historical data                       | Full historical backfill supported; no date restriction on uploaded data.         |
| 6  | Creative auto-creation from CSV       | Not supported — manual registration only.                                         |
| 7  | Partial CSV imports                   | Not supported — file-level all-or-nothing validation.                             |
| 8  | System-enforced naming convention     | Not enforced — system matches names defined externally by the team.               |
| 9  | Product attribution                   | One product per creative; required at creation; manageable in admin/products.     |
| 10 | Aggregated metric math                | Always weighted via component sums; never mean of per-row ratios.                 |
| 11 | Anomaly exclusion granularity         | Per `(creative, platform, date)` record. Manual only in v1. Reason required.      |

---

## 10. Success Criteria

The v1 ships successfully when:

1. The team uploads daily CSVs for all four platforms with **< 2 minutes per upload**.
2. Validation rejections are clear enough that the team fixes and re-uploads on the **first retry** without external help.
3. Salam can answer *"what are our top 5 creatives by ROAS this month across all platforms, for product X"* in **under 30 seconds**.
4. Every blended metric in every view matches a hand-calculation done from the raw data — no off-by-aggregation errors.
5. The dashboard is **visually impressive** — the team uses it because they want to, not just because they have to.
6. The team has fully retired the Creative Wizard spreadsheet.
