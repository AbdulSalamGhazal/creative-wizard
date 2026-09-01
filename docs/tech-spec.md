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
- **Mutations are Server Actions** (`app/actions/*` — ~16 files). There is **no REST API surface** except: `POST /api/uploads/validate`, `POST /api/uploads/commit`, `POST /api/uploads/thumbnail` (file uploads need routes), `GET /api/health` (public health check: 200 ok / 503 degraded), and the **MCP server** at `/api/mcp/mcp` (bearer-authed, read-only — see §MCP server).
- **Auth boundary:** `middleware.ts` verifies the session cookie signature/TTL at the Edge for every route except `/signin`, `/api/health`, **`/api/mcp`** (its own bearer auth), `_next`, and root-level static assets. The dashboard layout re-checks and role/permission gates apply per action (defense in depth). A drift-pin test asserts the middleware's Web Crypto verifier accepts tokens signed by `lib/auth-cookie.ts`.
- **Single sources of truth in `lib/`** — never open-code these elsewhere:
  - `lib/metrics.ts` — every derived-metric SQL fragment (see §7)
  - `lib/palette.ts` — platform/series/product/type/funnel-metric colors (CSS-var backed, theme-aware) + platform labels/lists
  - `lib/format.ts` — usd/int/pct/`roas()`/compact/`monthDay`/isoDate (en-US pinned)
  - `lib/metric-labels.ts` — column-header vocabulary (one spelling of "Impr."/"Conv.")
  - `lib/permissions.ts` — the permission catalog (see §5)
  - `lib/campaign.ts` `buildCampaignName()` — the only builder of campaign registry names
  - `csv/platforms/types.ts` — `INTERNAL_FIELDS`/`FIELD_META`, typed so a new field fails compilation anywhere it isn't described
- **Navigation feedback:** any component driving route/searchParam changes uses `useNavTransition()` (`lib/nav-progress.ts`) so the global progress bar reflects pending navigation.

## 4. Data model (20 tables)

**Tenancy & people:** `accounts` (brands; `status_window_hours` per brand), `users` (role tier + granular `permissions` + `all_accounts` brand-membership flag, §5), `user_accounts` (brand membership — the brands a restricted `all_accounts = false` user may see; global join table, both FKs `ON DELETE CASCADE`; consulted only when `all_accounts = false`, §5).
**Catalog:** `products`, `creatives` (required `product_id`; unique per account; the legacy manual `status` column is dead — status is derived, §4.2; `priority smallint` NULLABLE = the team's MANUAL 1–3 importance judgment, 3 = highest, NULL = unrated — detail-page only, distinct from the computed "Rate"/rating concept), `tags`, `creative_tags` (no `account_id` — scoped transitively via the creative; cascading tag operations MUST be bounded by an account-scoped creatives subquery), `creative_platform_overrides` (manual per-creative×platform termination).
**Campaigns:** `campaigns` — the registry. `performance_records.campaign_id` is a NOT NULL FK to it; the display name is the built `Campaign ➤ Adset (IG|FB)` string, created only via `buildCampaignName()`.
**Performance:** `performance_records` — the fact table. **Unique on `(creative_id, platform, campaign_id, date)`.** Carries `excluded_from_aggregates` and a NOT NULL `upload_batch_id`.
**Ingestion:** `upload_batches`, `upload_validation_sessions` (validate→commit state, 10-min TTL, account pinned at validate time), `platform_field_mappings` (admin-editable CSV header candidates).
**Config & audit:** `rating_rules` (PK = account_id), `platform_rating_rules` (PK = account_id+platform), `summary_views` (saved views, per-user defaults), `audit_events` (append-only, account-stamped).
**Store (Salla orders — §Store module):** `store_orders` (grain = one order; core cols `order_id`/`order_date`/`total_amount` SAR + `attributes` jsonb for custom fields; unique `(account_id, order_id)`), `store_order_fields` (config: 3 locked core rows + custom fields, accepted `headers[]` for explicit mapping), `store_upload_batches` (per-upload; drives rollback). All tenant tables; separate from the ads `upload_batches`/`performance_records`.

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
- **Brand membership (WHERE, vs. permissions' WHAT):** `users.all_accounts` (default `true` = every brand, **including brands created later**) + the `user_accounts` join table gate which brands a user may see. **Admins are always effectively all-accounts.** Enforced at tenant resolution (`lib/tenant.ts` + pure `lib/account-access.ts`): `listAccounts()` returns only allowed brands (switcher, Brands tab, `setActiveAccount` all follow); `getActiveAccountId()` honors the `ccms_account` cookie only when it names an allowed brand, else falls back to the user's first allowed brand (a forged/stale cookie is not an error); zero allowed brands → the full-page "No brand access" screen (rendered by the dashboard layout before any tenant query). `listAllAccounts()` is the unfiltered list (Team admin + slug/grant checks).
- **Management UI:** the unified **Team** page (`/admin/users`; `/admin/access` redirects there) — per-user preset selector (Admin/Editor/Viewer/Custom) + grouped permission checkboxes derived from the catalog, plus a **Brands** section (All-brands toggle or per-brand checkboxes; admins forced all-brands). Guardrails: no self-editing (access *and* brands), last admin protected, changes audit-logged (`user.permissions_update`, `user.brands_update`).
- Reading dashboards requires only a valid session and membership in ≥1 brand. Brand switching (`ccms_account` cookie) is scoped to the user's allowed brands — **brand membership IS a security boundary; permissions gate capabilities within a brand.**

## 5b. MCP server (connect your own LLM)

- **What:** a remote MCP server (Streamable HTTP, via `mcp-handler`) at **`/api/mcp/mcp`** so each user can connect their own LLM (Claude Desktop/Code, Cursor, ChatGPT dev-mode, SDKs) to READ-ONLY analytics. Route: `app/api/mcp/[transport]/route.ts` (Node runtime, `maxDuration` 60); tools in `lib/mcp/tools.ts`.
- **Auth = personal access tokens**, NOT the session cookie. `api_tokens` stores only a SHA-256 (`token_hash`, unique) + display `prefix`; the raw `cwz_…` secret is shown ONCE. `lib/api-token.ts` mints/verifies (constant-time compare, rejects revoked, throttled `last_used_at`). A token ACTS AS its owner — brand membership + read scope apply exactly as in the web app. Managed self-serve at `/account/api` (every user owns their tokens; audited `token.create`/`token.revoke`). `/api/mcp` is excluded from the middleware cookie gate — the route's `verifyApiToken` is the boundary.
- **Tenant without cookies:** MCP requests carry no cookie, so `lib/tenant.ts` `runWithTenant(accountId, userId, fn)` sets an `AsyncLocalStorage` override (`lib/tenant-context.ts`) that `getActiveAccountId()`/`auth()` consult FIRST; it validates `accountId` is one of the user's allowed brands before entering — so every `db/queries/*` is tenant-correct with zero changes inside it. Each tool resolves a `brand` arg (name/id) against allowed brands, then runs inside `runWithTenant`.
- **Tools (10, all read-only, Zod-schema'd, compact JSON with a `{brand, range}` echo, reuse `db/queries/*`):** `list_brands`, `get_kpis`, `list_creatives`, `get_creative`, `list_campaigns`, `get_campaign`, `get_summary`, `get_timeseries`, `get_funnel`, `get_data_freshness`. Descriptions state units (USD), date format (YYYY-MM-DD), and that blended metrics are weighted. Guardrails: 60 calls/min per token, ≤500 rows per list tool (`truncated` flag).
- **Scope guard:** v1 is STRICTLY read-only — no tool mutates. OAuth 2.1 for claude.ai-web/ChatGPT-web connectors is out of scope (Phase 2); v1 targets header-auth clients. Migration **0029** (additive: `api_tokens`).

## 5c. Store module (manual Salla order uploads)

- **What:** a top-level **Store** section (in the sidebar's Store group) split into TWO pages — `/store/uploads` (upload history + `/new` flow) and `/store/orders` (the orders table, SAR). `/store` redirect-stubs to `/store/orders`. A NEW module, PARALLEL to and independent of the ads pipeline (touches no `csv/`, `upload_batches`, or `performance_records`).
- **Grain + fields:** one row per order. Exactly THREE core fields — `order_id`/`order_date`/`total_amount` (SAR). Everything else is an admin-defined CUSTOM field (`store_order_fields`: label, type text|number|date, required?, accepted `headers[]`) whose values live in `store_orders.attributes` jsonb. Core rows are seeded per account (migration 0030 + `createAccount`) and LOCKED by `CORE_KEYS` (`store/fields.ts`): only their label + headers are editable. Config UI = the **Store fields** tab in `/admin/catalog` (`config.store`). **Every defined field is offered in the Orders table's Columns menu** — visibility is each viewer's per-browser choice (persisted as a HIDDEN-key set, so newly-added fields default to visible). The old per-field `show_in_table` toggle was retired 2026-08 (column kept dead, additive-only).
- **Upload pages (mirrors the ads `/uploads` + `/uploads/new` pattern):** `/store/uploads` is the upload HISTORY (recent batches: filename, when, by, counts, upsert flag, rollback while eligible) with a "New upload" button → `/store/uploads/new`, which hosts the full flow (dropzone → validate → error report/summary → confirm) via `StoreUploadPanel`; a successful commit lands back on `/store/uploads` with the new batch (`redirectOnCommit`). Nav item "Upload orders" (`/store/uploads`) prefix-highlights on `/new`.
- **Upload pipeline (`store/`):** own error catalog `store/errors.ts` (S-codes), reuses the shared `csv/parse.ts` engine, EXPLICIT header mapping from `store_order_fields.headers` (case-insensitive after trim — never auto-detected; a required field with no matching header fails fast). Two server actions (no session table): validate → error report OR "N new · M updated" → confirm → `commitStoreUpload` re-validates + writes transactionally (`writeStoreBatch`). **Upsert is a toggle** like the ads upload (default strict insert; on = update existing in place, keeping the row's original `upload_batch_id` so rollback removes only inserts). Rollback ≤24h (`upload.rollback`). Permissions: `store.upload` (+ `upload.upsert` for the toggle). Audit `store.upload_commit`/`store.upload_rollback`/`store.fields_update`.
- **Orders page (`/store/orders`, open to any brand member):** SERVER-paginated (100/page + total count — order volume reaches 100k+), URL-backed date range + order-id search ONLY (no other filters, deliberate), a totals footer (count + `SUM(total_amount)` over the whole filtered set), every defined field selectable in the Columns menu (custom columns rendered by type; hidden-key set in localStorage so new fields default visible), CSV export of the filtered set (≤10k). SAR via `sar()` in `lib/format.ts` (module-local; no USD conversion here — ad-spend blending is a later phase).
- **Order cleanup (`/store/uploads`, `store.cleanup`):** the Store twin of the ads record-cleanup tool — a danger-tinted card below the upload history. Filters (≥1 required, AND-combined): order-date range, upload batch, order-id(s) (exact / comma-separated). Preview (`previewStoreCleanup`: order count + SAR total + date span) → type-DELETE-to-confirm → transactional account-scoped hard delete (`deleteStoreOrders`). Audit `store.bulk_delete` with the filter set + the count actually removed. Sanctioned `store_orders` delete paths are now **batch rollback + this cleanup tool**.
- **Reconciliation (`/store/reconciliation`, read-open to any signed-in user):** compares store ORDER COUNTS vs platform-claimed CONVERSIONS per day — **counts only, NO revenue comparison anywhere** (a standing product decision; store revenue SAR / spend USD are optional hidden context columns, never diffed). No chart. A KPI summary row (MetricCards: Store orders · Platform conv. · Δ · Match rate = claimed/store, "—" when store=0) sits above the table — headline totals are mode-independent (both modes reconcile to them); in By-platform mode each tile additionally shows per-platform breakdown bars (platforms with data only, + the Unattributed bucket on the orders/Δ tiles so bar sums match the headline). Table with two modes: **Overview** (DataTable: Day, Store orders, Platform conv., Δ = store−claimed, Δ% = Δ/store — "—" when store=0, warn-tinted by |magnitude| since over- and under-claim are both discrepancies; weighted totals footer) and **By platform** (grouped-header table, the summary-table exception: per-platform [Store orders | Claimed | Δ] + an **Unattributed** group). Date range is the only filter (URL-backed); rows = days where either side has data, desc; ads side respects `excluded_from_aggregates=false`. **Attribution:** each order's source comes from a configured custom field (`accounts.store_source_field_key`); its raw value maps to a platform (or "not an ad platform") via `store_source_mappings` (explicit only — unmapped/empty/not-ad → Unattributed, so per-platform + unattributed always reconcile to the Overview count). Config lives in Configuration → Store (`config.store`, audit `store.source_mapping_update`). By-platform shows a not-configured empty state until the source field is set; an unmapped-values banner links to config; days within 7 days of a platform's data horizon get a muted "still attributing" marker (visual only). Migration **0031** (additive: `accounts.store_source_field_key` + `store_source_mappings`).

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
- **Browser-tab titles:** the root layout sets a template (`title: { template: "%s · Wizard", default: "Wizard" }`), so a listing page reads `<Page> · Wizard` and a detail page `<Section> · <Name> · Wizard` (e.g. `Creative · URJ_VID_001 · Wizard`). Every route exports a `metadata.title` matching its sidebar/h1 label; detail routes use `generateMetadata` over a `cache()`-deduped query so the title and the page share one fetch. Redirect stubs set none. The tab ICON is the `app/icon.png` file convention — never add a `metadata.icons` key, it would override it.

## 9. Routes

The sidebar groups routes into three labeled sections (`NAV_SECTIONS` in `nav-items.ts`): **Ads**, **Store**, **Admin**.

- **Ads:** `/` (dashboard) · `/summary` · `/creatives` (+ `/new`, `/bulk`, `/[name]`) · `/campaigns` (+ `/new`, `/[campaign]`) · `/funnel` · `/compare` · `/trends/{over-time,by-type,by-tag,launches,video}` · `/uploads` (+ `/new`).
- **Store:** `/store/uploads` (+ `/new`) · `/store/orders` · `/store/reconciliation`. (`/store` redirect-stubs to `/store/orders`.)
- **Admin:** `/admin/catalog` (products/tags/brands + Store fields), `/admin/users` (Team + Access), `/admin/audit`, `/admin/platforms` (CSV mappings).
- `/signin`. Redirect stubs: `/store`, `/admin/products`, `/admin/access`, `/trends`.

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
