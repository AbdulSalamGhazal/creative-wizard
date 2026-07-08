# Urjwan Creative Management System — Technical Specification

**Version:** 2.0 (current-state rewrite)
**Owner:** Salam — Urjwan
**Status:** LIVING DOCUMENT — describes the system **as built and deployed** (2026-07). Supersedes v1.1 entirely (v1.1 described the pre-build plan; its history is preserved in git).
**Related documents:** `docs/validation-spec.md` v1.2 (binding — CSV ingestion), `docs/prd.md` (historical product intent), `CLAUDE.md` (operating rules for AI-assisted sessions; when this spec and CLAUDE.md disagree, flag the conflict — don't resolve silently).

---

## 1. What the system is

A **multi-tenant creative-performance analytics tool** for paid social. It manages 2–5 brands from one database, ingests platform exports (CSV/XLSX) through a strict validation pipeline, and serves read-heavy dashboards that answer "which creatives and campaigns are working, where, and why".

- **Platforms:** `instagram`, `facebook`, `tiktok`, `snapchat` (Meta is split into IG + FB; a short ` (IG)`/` (FB)` tag keeps the same Meta campaign distinct per channel).
- **Data enters ONLY via upload** (no ad-platform API sync, no background jobs, no queues — a deliberate scope decision; see `docs/system-strategy-review.md`).
- **Production:** https://creative.urjwan.com — live, in daily use.

## 2. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript `strict` (+ `noUncheckedIndexedAccess`, `noImplicitOverride`) |
| Database | Postgres (Neon, eu-central-1) via **Drizzle ORM**; local dev = Docker Postgres 16 (`docker-compose.yml`) |
| Auth | **Custom** HMAC-signed cookie sessions (`lib/auth-cookie.ts`) + bcryptjs passwords (`lib/auth-password.ts`), enforced by `middleware.ts` (Edge, Web Crypto) |
| UI | Tailwind v4 (CSS-config, no tailwind.config file) + shadcn/ui + Recharts (shadcn charts), lucide icons, sonner toasts, next-themes |
| Validation | Zod everywhere (`validators/` + co-located schemas in actions/routes) |
| Files/ingest | papaparse (CSV), SheetJS `xlsx` (Excel), react-dropzone |
| Storage | **Vercel Blob** for creative thumbnails (public access — deliberate; client downscales → WebP before upload) |
| Hosting | Vercel (`fra1`), GitHub-integrated — **pushing `main` auto-deploys** |

**Deliberately NOT used** (remove on sight if reintroduced): Auth.js/next-auth/Google SSO, Vercel KV, TanStack Query/Table, react-hook-form, framer-motion, Prisma/Sequelize. New dependencies require a one-line justification in the PR.

## 3. Architecture

- **Server Components by default.** `"use client"` only for interactivity. Pages compose one view; **all data fetching lives in `db/queries/*`** (account-scoped), never inline in pages.
- **Mutations are Server Actions** (`app/actions/*` — ~15 files). There is **no REST API surface** except: `POST /api/uploads/validate`, `POST /api/uploads/commit`, `POST /api/uploads/thumbnail` (file uploads need routes), and `GET /api/health` (public health check: 200 ok / 503 degraded).
- **Auth boundary:** `middleware.ts` verifies the session cookie signature/TTL at the Edge for every route except `/signin`, `/api/health`, `_next`, and root-level static assets. The dashboard layout re-checks and role/permission gates apply per action (defense in depth). A drift-pin test asserts the middleware's Web Crypto verifier accepts tokens signed by `lib/auth-cookie.ts`.
- **Single sources of truth in `lib/`** — never open-code these elsewhere:
  - `lib/metrics.ts` — every derived-metric SQL fragment (see §7)
  - `lib/palette.ts` — platform/series/product/type/funnel-metric colors (CSS-var backed, theme-aware) + platform labels/lists
  - `lib/format.ts` — usd/int/pct/`roas()`/compact/`monthDay`/isoDate (en-US pinned)
  - `lib/metric-labels.ts` — column-header vocabulary (one spelling of "Impr."/"Conv.")
  - `lib/permissions.ts` — the permission catalog (see §5)
  - `lib/campaign.ts` `buildCampaignName()` — the only builder of campaign registry names
  - `csv/platforms/types.ts` — `INTERNAL_FIELDS`/`FIELD_META`, typed so a new field fails compilation anywhere it isn't described
- **Navigation feedback:** any component driving route/searchParam changes uses `useNavTransition()` (`lib/nav-progress.ts`) so the global progress bar reflects pending navigation.

## 4. Data model (16 tables)

**Tenancy & people:** `accounts` (brands; `status_window_hours` per brand), `users` (role tier + granular `permissions`, §5).
**Catalog:** `products`, `creatives` (required `product_id`; unique per account; the legacy manual `status` column is dead — status is derived, §4.2), `tags`, `creative_tags` (no `account_id` — scoped transitively via the creative; cascading tag operations MUST be bounded by an account-scoped creatives subquery), `creative_platform_overrides` (manual per-creative×platform termination).
**Campaigns:** `campaigns` — the registry. `performance_records.campaign_id` is a NOT NULL FK to it; the display name is the built `Campaign ➤ Adset (IG|FB)` string, created only via `buildCampaignName()`.
**Performance:** `performance_records` — the fact table. **Unique on `(creative_id, platform, campaign_id, date)`.** Carries `excluded_from_aggregates` and a NOT NULL `upload_batch_id`.
**Ingestion:** `upload_batches`, `upload_validation_sessions` (validate→commit state, 10-min TTL, account pinned at validate time), `platform_field_mappings` (admin-editable CSV header candidates).
**Config & audit:** `rating_rules` (PK = account_id), `platform_rating_rules` (PK = account_id+platform), `summary_views` (saved views, per-user defaults), `audit_events` (append-only, account-stamped).

### 4.1 Write/delete invariants

- Nothing writes to `performance_records` except the transactional commit route under a parent batch. **Four sanctioned delete paths only:** batch rollback (≤24 h, requires `upload.rollback`), the record-cleanup tool (filtered hard-delete, preview-then-confirm), `deleteCreative`, and `deleteCampaign` — each transactional (the FKs have no `ON DELETE CASCADE`; code compensates), permission-gated, confirm-with-summary, audit-logged.
- Every tenant table carries `account_id`; every query in `db/queries/*` injects `eq(accountId, getActiveAccountId())`; every write stamps it. FK targets are re-validated against the active account before writes (the FKs alone only prove global existence).
- Schema changes go through Drizzle migrations — additive whenever possible; **migrations run manually** against the direct Neon URL (§9), never on deploy.

### 4.2 Derived status (not stored)

- **Creative status** (4-state: New / Active / Pause / Terminated) — derived from spend recency per platform, anchored to each platform's own latest `spend > 0` day within the brand's `status_window_hours`; manual termination is sticky per creative×platform. Logic: `lib/creative-status.ts` + `db/queries/creative-status.ts`.
- **Campaign status** (2-state: Active / Inactive) — same anchoring, no override. Logic: `lib/campaign-status.ts` + `db/queries/campaign-status.ts`.
- Because these are derived, status "filters" are applied in the query layer after computation — they can never be a SQL `WHERE`.

## 5. Auth & access control

- **Session cookie:** `<userId>.<issuedAtMs>.<hmac>`, HMAC-SHA256 over `AUTH_SECRET`, `timingSafeEqual`, 30-day server-enforced TTL, future-issued rejection. Changing the format logs every user out — treat as a breaking change.
- **Tiers:** `admin` bypasses all permission checks. Below admin, access is **granular per-user permissions** from the catalog in `lib/permissions.ts` (~20 permissions in 5 groups: creatives, campaigns, data & uploads, catalog & config, administration). `users.permissions` NULL ⇒ fall back to the role preset (`editor` preset = legacy editor powers; `viewer` = read-only). Enforcement is server-side via `requirePermission()` in every action/route; the UI additionally hides what the user can't do.
- **Management UI:** the unified **Team** page (`/admin/users`; `/admin/access` redirects there) — per-user preset selector (Admin/Editor/Viewer/Custom) + grouped permission checkboxes derived from the catalog. Guardrails: no self-editing, last admin protected, permission changes audit-logged.
- Reading dashboards requires only a valid session. Brand switching (`ccms_account` cookie) is open to all signed-in users — **multi-tenancy is an organizational boundary, not a security boundary.**

## 6. CSV ingestion (binding spec: `docs/validation-spec.md` v1.2)

Five stages — parse → header mapping → row validation → cross-row/file checks → DB-level duplicate checks. Stages 1–2 fail fast; 3–5 collect all errors into one report. **All-or-nothing:** nothing is written unless the whole file is clean and the user confirms; the commit is a single transaction (batch row + chunked inserts), backstopped by the unique index. Error codes live exclusively in `csv/errors.ts`. Matching is deliberately *forgiving on whitespace* (cells trimmed; no NFC normalization; blank numeric cells read as 0) — this is intended behavior as of v1.2, do not "fix" it to strict. **Upsert mode** (opt-in per upload) skips the already-imported rejection and updates existing rows in place (batched `UPDATE … FROM VALUES`); built for rolling attribution backfills; updates are not rollback-able. XLSX is accepted alongside CSV.

## 7. Aggregation rules (CRITICAL — never violate)

- Every blended metric = **weighted average via component sums**: `SUM(num) / NULLIF(SUM(den), 0)`. Never `AVG(ratio)`.
- All fragments imported from `lib/metrics.ts` (incl. `aov`, `roas`, video hook/hold on 2s + quartile columns). `NULLIF` ⇒ undefined renders as `—`, never 0 or ∞.
- Aggregations filter `excluded_from_aggregates = false` by default; `?includeExcluded=1` opts out for diagnostics; detail views always show excluded rows with a badge.
- Raw SQL only in `db/queries/performance.ts`, wrapped in typed helpers.

## 8. UI system

- **Themes:** 4 — `midnight` (default, dark, `:root` base), `contrast` (dark), `frost` (cool light), `paper` (warm light). next-themes class strategy, `cw-theme` storage key, stale-theme migration in the pre-paint script. All data colors (platform/series/product/type/funnel-metric) are CSS variables with light-theme re-tunes — charts stay readable on every theme. One UI font (Plus Jakarta Sans) + Instrument Serif for display headings; the font-switching axis was removed.
- **Shared primitives (mandatory for new surfaces):** `PageShell`/`PageHeader`, `DataTable<T>` (all flat tables; the grouped-header Summary table is the one sanctioned exception), `MetricPicker`, `SeriesLegend`, `ChartTooltip`, `ChartShell` + `ChartFitToggle`, `PlatformDot`, `DeltaBadge`, `StatusBadge`/`CampaignStatusBadge`, `FilterPill` + `FilterSheet` (mobile filter collapse), `DownloadCsvButton`. Every route has a tailored `loading.tsx`; empty states are designed (dashed-box pattern); numbers use tabular figures; USD via en-US currency format; ISO dates in tables, friendly dates in tooltips/headers.
- **Responsive:** sidebar ≥ lg; below lg a hamburger Sheet (same `nav-items.ts` source); filter bars collapse to a "Filters (n)" Sheet.

## 9. Routes

`/` (dashboard) · `/summary` · `/creatives` (+ `/new`, `/bulk`, `/[name]`) · `/campaigns` (+ `/new`, `/[campaign]`) · `/funnel` · `/compare` · `/trends/{over-time,by-type,by-tag,launches,video}` · `/uploads` (+ `/new`) · admin: `/admin/catalog` (products/tags/brands), `/admin/users` (Team + Access), `/admin/audit`, `/admin/platforms` (CSV mappings) · `/signin`. (`/admin/products`, `/admin/access`, `/trends` are redirect stubs.)

## 10. Deployment & operations

- **Vercel**, region `fra1`, GitHub push-to-`main` auto-deploys; a failed build keeps the previous deploy serving. Always use https://creative.urjwan.com (not the `*.vercel.app` host).
- **Env vars (prod):** `DATABASE_URL` (Neon **pooled** host — required because `lib/db.ts` uses `max: 1`, `prepare: false` per serverless instance), `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`. Local prod copies live in gitignored `.env.production.local`.
- **Migrations are manual:** `DATABASE_URL='<direct-neon-url>' npx drizzle-kit migrate` (derive the direct URL by removing `-pooler.` from the host). Never run `db:seed` against prod. First/extra admins via `db/create-admin.ts`.
- **Health:** `GET /api/health` (point an uptime monitor at it). DB client fails fast (`connect_timeout: 10`) into the calmer error boundary.

## 11. Testing

- **Unit tests (vitest, co-located):** 174 tests / 16 files as of v2.0 — CSV pipeline + cross-platform checks, metrics fragments (SUM/NULLIF shape), creative/campaign status derivation, auth-cookie (incl. the middleware drift-pin), permissions catalog, campaign-name builder, formats/urls/date-presets. `npm test` (watch) / `npx vitest run`.
- **Known gap:** `db/queries/*` has no DB-backed tests yet; a `ccms_test`-database harness (`npm run test:db`) is the planned next investment.
- Rule: a test accompanies any non-trivial logic, especially in `csv/` and `db/queries/`.

## 12. Changelog

- **2.0 (2026-07):** Full current-state rewrite after the 2026-07 audit + remediation (security hardening, granular permissions, 4-theme system, UI primitive consolidation). The planned campaign-diagnosis page was cancelled and its spec deleted.
- **1.1 and earlier:** pre-build planning documents — see git history.
