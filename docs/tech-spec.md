# Urjwan Creative Management System — Technical Specification

**Version:** 1.1 (Revised)
**Owner:** Salam — Urjwan
**Related documents:** `urjwan-ccms-prd.md` (v1.2), `urjwan-ccms-validation-spec.md`
**Status:** Ready for `CLAUDE.md` and implementation

> ---
> ## ⚠️ HISTORICAL DOCUMENT (v1 planning) — superseded in key areas
>
> This tech-spec describes the system as **planned** (pre-build). The build pivoted
> in several load-bearing ways; where this document and the code disagree, the
> code + `CLAUDE.md` win. The major pivots:
>
> - **Auth:** custom HMAC-signed cookie sessions + bcrypt passwords
>   (`lib/auth-cookie.ts`), enforced by `middleware.ts` — NOT Google SSO/Auth.js.
> - **Platforms:** `instagram` / `facebook` / `tiktok` / `snapchat` — Meta was
>   split into IG + FB, and Google/YouTube was dropped.
> - **Multi-tenant:** 2–5 brands in one DB via row-level `account_id`
>   (`accounts` table + `ccms_account` cookie switcher) — not single-tenant.
> - **Campaign identity:** `performance_records.campaign_id` (uuid FK → the
>   `campaigns` registry). Campaign names are built ONLY through
>   `buildCampaignName()` — `Campaign ➤ Adset` + ` (IG)`/` (FB)` platform tags.
> - **Video metrics:** 2s views + 25/50/75/100% quartiles — not 3s/15s.
> - **Upload sessions:** stored in Postgres (`upload_validation_sessions`) —
>   Vercel KV was never used.
> - **Mutations:** Next.js Server Actions — there is no REST API surface.
> - **Thumbnails:** stored PUBLIC in Vercel Blob (deliberate decision) — not
>   private+signed.
> - **Creative status:** derived dynamically from spend recency (4-state) with
>   per-platform manual termination — not a manually-managed enum.
>
> A full v2 rewrite of this document is a separate task; sections below are
> retained verbatim for historical context.
> ---


---

## 1. Purpose

This document specifies the technical architecture and implementation conventions for the Urjwan CCMS. It is the third document in the planning set:

- **PRD** — what we're building, for whom, and why.
- **Validation Spec** — how CSV uploads are accepted or rejected.
- **Tech Spec** (this document) — how the system is architected and built.

The tech spec is the contract Claude Code reads when making architectural decisions. Day-to-day code style and "do/don't" rules live in `CLAUDE.md`, which is shorter and re-read every session.

---

## 2. Stack

| Layer             | Choice                              | Rationale                                                                                       |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Framework         | Next.js (App Router, latest stable) | Full-stack React. Server Components fit dashboard data fetching; Server Actions fit mutations.   |
| Language          | TypeScript (strict)                 | Type safety end-to-end; non-negotiable for an analytical app.                                    |
| Database          | PostgreSQL                          | Mature, excellent for analytical queries, native JSONB for raw payload storage.                  |
| ORM               | Drizzle ORM                         | SQL-first, lightweight, serverless-friendly. Easy to drop to raw SQL for analytics queries.     |
| Database host     | Neon                                | Serverless Postgres, branch-per-PR, native Vercel integration.                                   |
| Auth              | Auth.js (NextAuth v5)               | Google provider with domain restriction is two lines of config.                                  |
| Object storage    | Vercel Blob                         | Thumbnails with signed URLs out of the box.                                                      |
| Upload cache      | Vercel KV (Redis)                   | Stash parsed-validated rows between the validate step and the commit step (~10 min TTL).         |
| Styling           | Tailwind CSS                        | Standard for fast UI work; pairs with shadcn/ui.                                                 |
| UI components     | shadcn/ui                           | Copy-in primitives, fully ownable, accessible.                                                   |
| Charts            | shadcn/ui charts (Recharts under)   | Tasteful defaults, fully themable; drop to raw Recharts for custom views.                        |
| Tables            | TanStack Table v8                   | Headless, virtualizable, sortable/filterable.                                                    |
| Forms             | React Hook Form + Zod resolver      | Schemas reused on the server.                                                                    |
| Server validation | Zod                                 | All request bodies and CSV row shapes validated through Zod schemas.                             |
| CSV parsing       | papaparse                           | Streaming-capable, handles edge cases reliably.                                                  |
| Client data       | TanStack Query                      | Cache, refetch, optimistic updates for client-driven interaction.                                |
| File upload UI    | react-dropzone                      | Battle-tested drag-and-drop.                                                                     |
| Animations        | framer-motion                       | KPI tile count-ups, chart entrances, page transitions.                                           |
| Hosting           | Vercel                              | Native Next.js; edge network covers MENA reasonably.                                             |

---

## 3. High-Level Architecture

The system is a single Next.js app deployed to Vercel, talking to a single Neon Postgres instance, a Vercel Blob store, and a Vercel KV namespace. No separate backend service.

Flow:

1. **Browser** — renders Server Components (dashboards). Interacts via Server Actions (mutations) and a few REST endpoints (uploads).
2. **Next.js** — Server Components and Route Handlers in the same app. Server Components fetch data directly via Drizzle.
3. **Postgres (Neon)** — source of truth for users, products, creatives, upload batches, and performance records.
4. **Vercel Blob** — stores thumbnail images. Signed URLs for read.
5. **Vercel KV** — temporary cache for the validate→commit handoff during CSV uploads.
6. **Auth.js + Google** — sign-in; restricts to Urjwan workspace domain; JWT session strategy.

CSV upload uses a Route Handler (not a Server Action) because it accepts multipart bodies.

---

## 4. Folder Structure

```
ccms/
├── app/
│   ├── (auth)/
│   │   └── signin/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                # Sidebar, top bar, global filters
│   │   ├── page.tsx                  # Overview
│   │   ├── creatives/
│   │   │   ├── page.tsx              # Library
│   │   │   ├── new/page.tsx
│   │   │   └── [name]/
│   │   │       ├── page.tsx          # Creative detail
│   │   │       └── edit/page.tsx
│   │   ├── compare/page.tsx
│   │   ├── platforms/[platform]/page.tsx
│   │   ├── uploads/
│   │   │   ├── page.tsx              # Upload history
│   │   │   └── new/page.tsx
│   │   └── admin/
│   │       ├── users/page.tsx
│   │       └── products/page.tsx     # Product management
│   ├── api/
│   │   └── uploads/
│   │       ├── validate/route.ts     # POST: validate file, return token
│   │       └── commit/route.ts       # POST: commit by token
│   └── layout.tsx
├── components/
│   ├── ui/                           # shadcn primitives
│   ├── charts/                       # KpiTile, AreaByPlatform, TopCreatives, ...
│   ├── filters/                      # DateRange, ProductPicker, PlatformPicker, TagPicker
│   ├── creative/                     # CreativeCard, CreativeForm, TagInput, ProductSelect
│   ├── product/                      # ProductTable, ProductForm
│   └── upload/                       # Dropzone, ErrorReport, SummaryCard
├── lib/
│   ├── auth.ts                       # Auth.js config
│   ├── db.ts                         # Drizzle client
│   ├── kv.ts                         # Vercel KV client
│   ├── blob.ts                       # Vercel Blob helpers
│   ├── format.ts                     # USD, date, number formatters
│   ├── metrics.ts                    # Weighted-aggregation SQL helpers
│   └── utils.ts
├── db/
│   ├── schema.ts                     # Drizzle schema (all tables)
│   ├── migrations/                   # Generated migrations
│   └── queries/
│       ├── products.ts
│       ├── creatives.ts
│       ├── performance.ts            # Heavy aggregation queries (uses lib/metrics.ts)
│       └── uploads.ts
├── validators/
│   ├── product.ts
│   ├── creative.ts
│   ├── upload.ts
│   ├── exclusion.ts
│   └── filters.ts
├── csv/
│   ├── parse.ts                      # papaparse wrapper
│   ├── pipeline.ts                   # 5-stage validation pipeline
│   ├── errors.ts                     # Error codes from validation spec
│   └── platforms/
│       ├── meta.ts                   # Header map + quirks for Meta
│       ├── tiktok.ts
│       ├── snapchat.ts
│       └── google.ts
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── CLAUDE.md
├── README.md
└── docs/
    ├── prd.md
    ├── validation-spec.md
    └── tech-spec.md
```

---

## 5. Database Schema (Drizzle)

This is the canonical schema. Migrations are generated by `drizzle-kit`.

```typescript
// db/schema.ts
import {
  pgTable, uuid, text, varchar, timestamp, date, boolean,
  integer, bigint, numeric, jsonb, primaryKey, index, uniqueIndex
} from 'drizzle-orm/pg-core';

export const roleEnum = ['admin', 'editor', 'viewer'] as const;
export const platformEnum = ['meta', 'tiktok', 'snapchat', 'google'] as const;
export const creativeTypeEnum = ['video', 'slides', 'image'] as const;
export const creativeStatusEnum = ['draft', 'active', 'paused', 'archived'] as const;
export const productStatusEnum = ['active', 'archived'] as const;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 16, enum: roleEnum }).notNull().default('editor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 16, enum: productStatusEnum }).notNull().default('active'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  statusIdx: index('products_status_idx').on(t.status),
}));

export const creatives = pgTable('creatives', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  productId: uuid('product_id').notNull().references(() => products.id),
  type: varchar('type', { length: 16, enum: creativeTypeEnum }).notNull(),
  thumbnailUrl: text('thumbnail_url'),
  status: varchar('status', { length: 16, enum: creativeStatusEnum }).notNull().default('draft'),
  launchDate: date('launch_date'),
  notes: text('notes'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  productIdx: index('creatives_product_idx').on(t.productId),
  statusIdx: index('creatives_status_idx').on(t.status),
  typeIdx: index('creatives_type_idx').on(t.type),
}));

export const creativeTags = pgTable('creative_tags', {
  creativeId: uuid('creative_id').notNull().references(() => creatives.id, { onDelete: 'cascade' }),
  tag: varchar('tag', { length: 64 }).notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.creativeId, t.tag] }),
  tagIdx: index('creative_tags_tag_idx').on(t.tag),
}));

export const uploadBatches = pgTable('upload_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  platform: varchar('platform', { length: 16, enum: platformEnum }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => users.id),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  rowsImported: integer('rows_imported').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  rolledBackByUserId: uuid('rolled_back_by_user_id').references(() => users.id),
});

export const performanceRecords = pgTable('performance_records', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  creativeId: uuid('creative_id').notNull().references(() => creatives.id),
  platform: varchar('platform', { length: 16, enum: platformEnum }).notNull(),
  date: date('date').notNull(),
  spend: numeric('spend', { precision: 14, scale: 4 }).notNull(),
  impressions: integer('impressions').notNull(),
  clicks: integer('clicks').notNull(),
  conversions: integer('conversions'),
  conversionValue: numeric('conversion_value', { precision: 14, scale: 4 }),
  videoViews3s: integer('video_views_3s'),
  videoViews15s: integer('video_views_15s'),
  rawPayload: jsonb('raw_payload').notNull(),
  uploadBatchId: uuid('upload_batch_id').notNull().references(() => uploadBatches.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  // Anomaly exclusion
  excludedFromAggregates: boolean('excluded_from_aggregates').notNull().default(false),
  excludedReason: text('excluded_reason'),
  excludedByUserId: uuid('excluded_by_user_id').references(() => users.id),
  excludedAt: timestamp('excluded_at', { withTimezone: true }),
}, t => ({
  uniq: uniqueIndex('perf_creative_platform_date_idx').on(t.creativeId, t.platform, t.date),
  dateIdx: index('perf_date_idx').on(t.date),
  platformDateIdx: index('perf_platform_date_idx').on(t.platform, t.date),
  batchIdx: index('perf_upload_batch_idx').on(t.uploadBatchId),
  excludedIdx: index('perf_excluded_idx').on(t.excludedFromAggregates),
}));
```

**Index rationale:**
- `perf_creative_platform_date_idx` — uniqueness for duplicate detection; covers per-creative lookups.
- `perf_date_idx` — date-range scans for global filters.
- `perf_platform_date_idx` — platform-scoped dashboard queries.
- `perf_upload_batch_idx` — rollback queries (delete all rows of a batch).
- `perf_excluded_idx` — partial-index candidate for fast filtering of the (default) non-excluded set.
- `creatives_product_idx` — product-filter joins from performance queries.

---

## 6. Authentication

- Sign-in via Google through Auth.js v5.
- Restricted to the Urjwan Google Workspace domain in the `signIn` callback (rejects any email not ending in `@urjwan.com`).
- First sign-in on a fresh database creates a User with role `admin`. Subsequent first-time sign-ins default to `editor`.
- Sessions: JWT strategy, 30-day rolling expiry.
- All Server Components and Route Handlers call `auth()` early; unauthenticated access returns 401 or redirects to `/signin`.
- Admin-only actions (user management, product management, rollback, hard delete) are gated by `requireAdmin()` that throws on insufficient role.

---

## 7. CSV Upload Pipeline

The validate→commit flow is two endpoints sharing state via Vercel KV.

### 7.1 Endpoints

**`POST /api/uploads/validate`**
- Accepts: `multipart/form-data` with `file` (CSV) and `platform`.
- Runs the 5-stage validation pipeline from the Validation Spec.
- On success: stashes parsed validated rows in KV under a fresh UUID token (TTL 10 min). Returns:
  ```json
  {
    "token": "...",
    "summary": { "rows": 247, "creatives": 18, "dateRange": "2026-05-01 → 2026-05-25" },
    "warnings": []
  }
  ```
- On failure: returns the full error array; no token issued.

**`POST /api/uploads/commit`**
- Accepts: `{ token: string }`.
- Looks up the token in KV. Absent or expired → 410 Gone.
- In a Postgres transaction:
  1. Insert an `upload_batches` row.
  2. Bulk-insert all `performance_records` rows with that batch ID.
  3. Delete the KV token.
  4. Commit.
- Returns `{ batchId, rowsImported }`.

**`DELETE /api/uploads/:batchId`** (admin only)
- Verifies the batch is within 24 hours of creation.
- In one transaction: deletes all `performance_records` rows for the batch, updates the batch row to `status='rolled_back'`.

### 7.2 Implementation notes

- Pipeline lives in `csv/pipeline.ts`. Returns `{ ok: true, rows, warnings }` or `{ ok: false, errors }`.
- Platform-specific adapters in `csv/platforms/*.ts` export `{ requiredHeaders, headerMap, parseDate, quirks }`.
- Error codes are constants from `csv/errors.ts`. The error report UI knows nothing about platforms — it renders a uniform list.
- No raw-row data goes back to the client in the validate response. Only counts, ranges, and the token.

---

## 8. Dashboard Data Layer

### 8.1 Filters as URL state

Every filter (date range, products, platforms, creative types, tags, status, include-excluded toggle) is encoded in URL search params. Server Components read them via `searchParams` and pass them to query functions. Dashboards are bookmarkable, shareable, and reload-safe.

### 8.2 Weighted aggregation (mandatory)

**Every blended or aggregated metric is computed via weighted component sums, never as an average of per-row ratios.** This is the central rule of `lib/metrics.ts` and must be obeyed by every aggregation query in the system.

Concretely, the SQL pattern for derived metrics is:

```sql
-- CORRECT (weighted blend)
SUM(clicks)::numeric / NULLIF(SUM(impressions), 0)        AS ctr
SUM(spend)  / NULLIF(SUM(impressions), 0) * 1000          AS cpm
SUM(spend)  / NULLIF(SUM(clicks), 0)                      AS cpc
SUM(conversion_value) / NULLIF(SUM(spend), 0)             AS roas
SUM(spend)  / NULLIF(SUM(conversions), 0)                 AS cpa
SUM(video_views_3s)  / NULLIF(SUM(impressions), 0)        AS hook_rate
SUM(video_views_15s) / NULLIF(SUM(video_views_3s), 0)     AS hold_rate
```

```sql
-- WRONG (mean-of-ratios) — never write this
AVG(clicks::numeric / NULLIF(impressions, 0))             AS ctr_wrong
AVG(conversion_value / NULLIF(spend, 0))                  AS roas_wrong
```

`NULLIF(divisor, 0)` returns `NULL` when the divisor is zero, so the result coalesces to `NULL` — surfaced in the UI as `—`, never as zero, never as infinity.

All aggregation queries import their derived-metric SQL fragments from `lib/metrics.ts` rather than open-coding them. This keeps the formulas in one place and prevents drift between dashboards.

### 8.3 Exclusion handling

All aggregation queries apply `WHERE excluded_from_aggregates = false` by default. The URL filter `?includeExcluded=1` flips this to include excluded records, in which case excluded rows are visually marked in tables and tooltips.

Detail views (Creative Detail page, upload-history detail) always show every record regardless of exclusion, with an "Excluded" badge.

### 8.4 Aggregation queries

Heavy work happens in SQL — never iterate over performance records in JS.

- KPI tiles: a single query per period.
- Top creatives: `GROUP BY creative_id ORDER BY SUM(spend) DESC LIMIT 10`, joined with `creatives` for product/name.
- Spend-over-time: `GROUP BY date, platform`.
- By-product breakdown: `GROUP BY product_id` via join.

### 8.5 Caching

- Server Components use `cache()` per request to avoid duplicate queries.
- Heavy aggregations are wrapped in `unstable_cache` with tags, revalidated whenever `upload_batches` rows change OR any `performance_records` exclusion flag flips.
- Client navigation reuses TanStack Query cache keyed by filter hash (including the include-excluded flag).

---

## 9. API Surface

| Method | Path                                  | Auth     | Purpose                                |
| ------ | ------------------------------------- | -------- | -------------------------------------- |
| POST   | `/api/uploads/validate`               | Editor+  | Run validation, get a token            |
| POST   | `/api/uploads/commit`                 | Editor+  | Commit by token                        |
| DELETE | `/api/uploads/:batchId`               | Admin    | Roll back a batch                      |
| POST   | `/api/creatives`                      | Editor+  | Create a creative                      |
| PATCH  | `/api/creatives/:id`                  | Editor+  | Edit a creative                        |
| DELETE | `/api/creatives/:id`                  | Admin    | Hard delete (rare)                     |
| POST   | `/api/products`                       | Admin    | Create a product                       |
| PATCH  | `/api/products/:id`                   | Admin    | Edit / archive a product               |
| POST   | `/api/records/:id/exclude`            | Editor+  | Flag a performance record as excluded  |
| POST   | `/api/records/:id/include`            | Editor+  | Clear the exclusion flag               |
| POST   | `/api/users/invite`                   | Admin    | Invite a teammate                      |
| PATCH  | `/api/users/:id`                      | Admin    | Change role                            |

Reads (dashboards, library lists) go through Server Components, not REST endpoints.

---

## 10. Design System & UI Direction

The dashboard feels "fancy" — fluid, polished, dense without being noisy. Concretely:

- **Theme:** Dark default with light toggle via shadcn theme primitives. Brand accent: deep urjuwan magenta (`#D4145A`).
- **Typography:** Instrument Serif for display numerals (KPI tiles, big headlines), Plus Jakarta Sans for UI, IBM Plex Mono for tabular figures.
- **Motion:** framer-motion for KPI count-ups, chart entrance fades, page transitions. No animation > 300 ms for individual elements; chart strokes draw over ~1.4 s.
- **Charts:** shadcn/ui chart component with custom tooltips. Hover shows exact value; click drills into the creative detail page.
- **Skeletons:** every dashboard page and table has a tailored skeleton that mirrors the final layout. No generic spinners.
- **Empty states:** designed-out (icon + one-liner + CTA), not blank screens.
- **Tables:** sticky headers, column resize, sort indicators, virtualized rows beyond 200.
- **Filters:** sticky global filter strip below the top bar; selected filters render as removable chips. Product filter sits next to platform filter.
- **Excluded badges:** subtle but unmistakable. A small "EXCLUDED" pill in muted amber alongside the record's row or tooltip.

Visual direction is anchored in the four mockup files in `docs/mockups/`.

---

## 11. Performance

- Dashboard pages target P95 < 1.5 s for date ranges ≤ 90 days.
- Bulk insert of 50 k performance rows via Drizzle in chunks of ~1000 — under 5 s on Neon.
- The KV-backed validate/commit flow avoids re-reading and re-validating large files.
- All foreign keys and filter columns are indexed (see §5).
- The `excluded_from_aggregates = false` filter on aggregation queries hits a partial index for speed.

---

## 12. Deployment & Environment

- Vercel hosts the app. `main` deploys to production; every PR gets a preview deployment.
- Neon hosts the database. Production and preview branches each get a separate Neon branch via the Neon-Vercel integration.

Environment variables:

- `DATABASE_URL` — Postgres connection string
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — Google OAuth
- `AUTH_SECRET` — Auth.js session signing
- `AUTH_ALLOWED_DOMAIN` — e.g. `urjwan.com`
- `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` — Vercel KV
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob

---

## 13. Testing

- **Unit (vitest):** validation pipeline, platform adapters, derived-metric SQL helpers in `lib/metrics.ts`, formatters.
- **Integration:** upload→validate→commit happy path and major error paths; exclude/include flows; aggregation queries against seeded fixtures with known expected outputs (this catches drift between dashboards).
- **E2E (Playwright):** sign-in, upload, dashboard navigation, rollback, exclusion. Defer to v1.1 if scope tightens.

A representative CSV per platform is committed to `tests/fixtures/` (sensitive values redacted).

---

## 14. Observability

- Vercel logs for request-level errors and Server Action failures.
- Neon's slow-query log enabled in production.
- Optional: Sentry for client and server error tracking. Decided during the build.

---

## 15. Open Implementation Decisions

Deferred to the build phase because they don't need to be locked now:

1. **Exact column mappings per platform** — from real CSV samples (Validation Spec §9).
2. **Tag taxonomy** — free-form in v1; may introduce suggested tags later.
3. **Thumbnail dimensions / aspect ratio** — decided during the design pass.
4. **Default theme** — dark, confirmed in design artifacts.
5. **Automatic anomaly detection** — out of scope for v1; revisit once there's enough clean data to baseline against.
6. **`viewers` role in v1** — currently out of scope; trivial to add later.
