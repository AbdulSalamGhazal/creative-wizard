# CLAUDE.md — Operating Rules for the Urjwan CCMS Build

You are working on the Urjwan Creative Management System. Read this file at the start of every session.

## Source documents

Before any non-trivial decision, consult:

- `docs/prd.md` — product requirements
- `docs/validation-spec.md` — CSV validation rules (binding)
- `docs/tech-spec.md` — architecture and stack (binding)

If a rule here conflicts with one of those documents, the documents win — flag the conflict instead of resolving silently.

## Stack (do not change without discussion)

- Next.js (App Router) + TypeScript strict
- Drizzle ORM + Postgres (Neon)
- Auth: custom HMAC-signed cookie sessions (`lib/auth-cookie.ts`) + bcrypt passwords (`lib/auth-password.ts`). Users created via `/admin/users`; first admin via `db/create-admin.ts`. NOT Auth.js/Google — those were never wired up.
- Tailwind + shadcn/ui + shadcn charts (Recharts under the hood)
- TanStack Query (client data), TanStack Table (tables)
- papaparse (CSV), Zod (validation), framer-motion (motion)
- Vercel hosting. Vercel KV is NOT used (upload-validation sessions live in Postgres). **Vercel Blob IS used** for creative thumbnails: uploaded via `POST /api/uploads/thumbnail` (editor-only; client downscales→WebP first), stored public, and the returned URL is saved to `creatives.thumbnail_url`. Requires `BLOB_READ_WRITE_TOKEN` (auto-added when a Blob store is connected to the project); the blob host is allow-listed in `next.config.ts` `images.remotePatterns`.

Do not introduce a new dependency without a one-line justification in the PR description.

## Code conventions

- `tsconfig.json` is `strict: true`. Never use `any`. Prefer `unknown` and narrow.
- Server Components by default. Add `"use client"` only when you need interactivity, browser APIs, or React hooks.
- Files: kebab-case. Components: PascalCase. Functions and variables: camelCase. Constants: UPPER_SNAKE.
- Each route's page renders one composed view; data fetching lives in `db/queries/*`, not inline in pages.
- All inputs (route handler bodies, form data, URL params used as filters) are validated through Zod schemas in `validators/`.
- No raw SQL except in `db/queries/performance.ts` for analytical aggregations — and there, wrap with a typed helper.

## Database rules

- Schema changes go through Drizzle migrations. Never edit a generated migration; create a new one.
- Every column used in a filter, join, or sort needs an index. Declare it in the schema file alongside the column.
- When adding a new dashboard query, check whether existing indexes cover it; add one if not.
- `performance_records` is **unique** on `(creative_id, platform, campaign_name, date)` — the same creative can run on the same platform/date across different campaigns (distinct rows), but not the same campaign twice. Validation is still the only **entry** path. There are three sanctioned **exit** paths: (1) batch rollback within 24 h (admin-only), (2) the record-cleanup tool on `/uploads` (filtered hard-delete, editor-or-admin, preview-then-confirm, audit-logged via `upload.bulk_delete`), and (3) deleting a creative (`deleteCreative` in `app/actions/creative.ts`) — which removes that creative's records inside a transaction because `performance_records.creative_id` has NO `ON DELETE CASCADE`, then deletes the creative (its `creative_tags` cascade). Editor-or-admin, confirm-with-record-summary, audit-logged via `creative.delete`. No other code should delete from `performance_records`.
- Every creative has a required `product_id`. Products live in their own table and are managed in `/admin/catalog?tab=products`. Never let a creative be saved without one.

## Aggregation rules (CRITICAL)

- Every blended or aggregated metric is computed as a **weighted average via component sums** — never as a mean of per-row ratios. `SUM(clicks) / NULLIF(SUM(impressions), 0)`, never `AVG(clicks::numeric / impressions)`.
- All derived-metric SQL fragments are imported from `lib/metrics.ts`. Do not open-code them in `db/queries/*`. If the formula needs to change, change it in `lib/metrics.ts` and every dashboard updates.
- Use `NULLIF(divisor, 0)` so undefined values render as `NULL` → `—` in the UI, not as `0` or `Infinity`.
- All aggregation queries apply `WHERE excluded_from_aggregates = false` by default. The `?includeExcluded=1` URL param flips this for diagnostic views. Detail pages always show every record with an "Excluded" badge.

## Validation rules (from validation-spec.md)

- The CSV pipeline is 5 stages. Do not reorder them.
- Stages 1–2 fail fast. Stages 3–5 collect errors.
- Creative-name matching is **strict** — no trimming, case-sensitive, NFC only.
- All-or-nothing: nothing is written to `performance_records` unless the entire file is clean and the user confirms.
- Every error has a code from `csv/errors.ts`. Never invent ad-hoc error messages.

## UI rules

- The dashboard must feel polished. Every page has tailored skeletons. Empty states are designed-out, not blank.
- Use shadcn primitives. Don't reinvent components that exist.
- Tabular figures (`font-variant-numeric: tabular-nums`) on every number in tables.
- USD formatting: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.
- Dates: ISO format in tables, friendlier formats in chart tooltips and headers.

## Never

- Never write to `performance_records` without a parent `upload_batches` row.
- Never bypass the validation pipeline. No admin "force import" feature.
- Never compute a blended metric as `AVG(ratio)` — always `SUM(numerator) / NULLIF(SUM(denominator), 0)`.
- Never bypass the `excluded_from_aggregates = false` filter in aggregation queries unless the URL explicitly opts in.
- Never let a creative be saved without a `product_id`.
- Never store secrets in code or in client-side bundles.
- Never modify an uploaded CSV file on disk.
- Never use `any` to silence TypeScript.
- Never run `prisma` or `sequelize` commands — this project uses Drizzle.

## Workflow

- Make small, reviewable changes. One feature per PR or session.
- Add a test alongside any non-trivial logic, especially in `csv/` and `db/queries/`.
- When a change touches one of the documents in `docs/`, update the document in the same change.
- When the user corrects a mistake that could repeat, append a line to the "Learned" section below.

## Deployment (production) — LIVE

This app is deployed and in production use. Treat `main` as shippable.

- **Host:** Vercel, GitHub-integrated. Remote `origin` = `git@github.com:AbdulSalamGhazal/creative-wizard.git`. **Pushing to `main` auto-deploys** (`next build`); a failed build keeps the previous version serving (zero downtime).
- **URL:** https://creative.urjwan.com (custom domain, Let's Encrypt TLS, auto-renew). The `*.vercel.app` URL also resolves but Google Safe Browsing false-flags the shared domain — always use the custom domain.
- **Health check:** `GET /api/health` (public, no auth) → `200 {status:"ok"}` when the DB is reachable, `503 {status:"degraded"}` when not. Point an uptime monitor at it. The DB client (`lib/db.ts`) has `connect_timeout: 10` so an unreachable DB fails fast and surfaces the `(dashboard)/error.tsx` boundary (calmer "temporarily unavailable" copy for connection errors) instead of hanging; route errors `console.error` → visible in Vercel logs.
- **Database:** Neon Postgres (eu-central-1). Two connection strings:
  - **Pooled** (host contains `-pooler`) → this is `DATABASE_URL` in Vercel. Required because `lib/db.ts` uses `max: 1` per serverless instance.
  - **Direct** (no `-pooler`) → used ONLY to run migrations.
- **Vercel env vars:** `DATABASE_URL` (pooled) + `AUTH_SECRET`. Nothing else (no Google/KV/Blob). Local copies of all prod secrets live in gitignored `.env.production.local` — never commit it, never paste it into committed files.
- **Migrations do NOT run on deploy.** When a change adds a Drizzle migration, run it manually (before/with the deploy) against the **direct** url:
  ```
  DATABASE_URL='<direct-neon-url>' npx drizzle-kit migrate
  ```
  Source the direct url from the user or `.env.production.local`. **Never run `npm run db:seed` against prod** (demo data only). Add admins with:
  ```
  DATABASE_URL='<url>' ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx db/create-admin.ts
  ```
- **Prod admin:** salam@urjwan.com (seeded via create-admin). Password is user-managed — never hardcode or assume it.
- **Changing the session cookie format invalidates every login** (forces re-login). Current format: `<userId>.<issuedAtMs>.<hmac>`, 30-day server-enforced TTL.
- **Most changes need no migration.** Schema/structure changes are rare; day-to-day data (creatives, uploads, users) flows through the app UI. Only flag the migration step when a change actually touches `db/schema.ts`.

## Learned

- **`next build` fails on `react/no-unescaped-entities` — `tsc`/typecheck does
  NOT catch it.** A raw apostrophe/quote in JSX *text* (e.g. `that platform's
  day`) is an ESLint **error** that fails `next build` (and therefore the Vercel
  deploy), even though `npm run typecheck` is green. Escape as `&apos;`/`&rsquo;`
  or reword. When verifying a deploy, **never trust `npm run build | tail -n`** —
  the "Failed to compile" line scrolls above the tail window and looks like a
  success. Check the exit code and `grep -iE "failed to compile|Error:"` on the
  full log. A failed Vercel build silently keeps serving the previous deploy, so
  prod looks "not updated" with no error surfaced.

- **Campaign name + duplicate detection (v2).** `performance_records.campaign_name`
  stores the combined `Campaign ➤ Adset` value — and for **instagram/facebook**
  the platform is appended (e.g. `Holiday ➤ Broad (Instagram)`) so the same Meta
  campaign split across the two stays distinct in storage, filters, and pickers.
  The format is built ONLY through `lib/campaign.ts` `buildCampaignName()` (used
  by the CSV pipeline and the seed) — don't open-code it. Duplicates are keyed on
  `(creative, platform, campaign, date)` and rejected via E050 (intra-file) /
  E051 (already-imported) plus a unique index (migrations 0010+0011). The same
  creative across *different* campaigns on the same day is allowed. (This
  superseded the brief 0009 'allow duplicates + W003 advisory' step.)
- The admin record-cleanup tool (`/uploads`, `app/actions/cleanup.ts`) is a
  sanctioned hard-delete exit path for `performance_records`, added at the
  user's request. It overrides the original "rollback is the only exit path"
  rule. Available to editors + admins (via `requireEditor`). Guardrails: ≥1
  filter required, preview-then-confirm, audit-logged. Keep these whenever
  touching cleanup.
- **`platform`/`type`/`status` columns are `varchar`, NOT Postgres enums.** The
  Drizzle `pgEnum` helpers map to plain `varchar` columns (no DB-level enum
  type exists). So changing the allowed value set — e.g. the v2 `meta` →
  `instagram` + `facebook` split — needs only a code change, NO DB migration.
- **Adding a `NOT NULL` column to `performance_records` requires the table to
  be empty** (or a default/backfill). The v2 cutover added `campaign_name
  NOT NULL` (migration 0010), so prod performance data was cleared first
  (performance_records + upload_batches), keeping creatives/products/users.
- **The direct (non-pooler) Neon URL is derived, not stored.** `.env.production.local`
  holds only the pooled `DATABASE_URL`; for `drizzle-kit migrate` derive the
  direct URL by replacing `-pooler.` with `.` in the host.
- **Saved Summary Views + default-view redirect:** a saved view with an empty
  config (no filters) must apply via `?view=none`, never a bare `/summary` —
  otherwise the default-view `redirect()` bounces it back. `applyView()` in
  `views-control.tsx` handles this.
- **Prevent enum drift — DERIVE, don't re-list.** A validator/option list that
  mirrors the platform set or CSV field set must derive from the canonical
  source (`platformEnum`, `INTERNAL_FIELDS`) via spread, not hand-copied
  literals. Two drift bugs shipped in v2 from copied lists: `platform-mapping.ts`
  FIELDS (rejected `campaign_name`) and `validators/summary.ts`
  `METRIC_FILTER_SCOPES` (kept dead `meta`, dropped IG/FB filters). Both now use
  `[...platformEnum]` / `INTERNAL_FIELDS`.
- **csv/pipeline.ts dedup key uses an INVISIBLE U+0001 (SOH) separator.** It does
  NOT render in the Read tool, grep output, or most diffs, so the key-build and
  `k.split(...)` lines LOOK like they have no delimiter — they DO. A review pass
  false-flagged this as a `split("")` bug; it is correct. Confirm with
  `python3 -c '...repr(line)'` before "fixing", and use Python (not the Edit
  tool) to modify those lines — Edit can't match the control char.
- **Creative detail page edits EVERYTHING inline; there is no `/edit` route.**
  The detail header (`components/creative/creative-detail-header.tsx`, a client
  component) is a full editor for name / product / type / status / thumbnail /
  publish-date / tags, with draft state + a dirty check + an explicit **Save
  changes** button (not auto-save). Save calls `patchCreative` (partial — only
  changed fields; renaming is uniqueness-checked and the client follows the new
  URL). The old `/creatives/[name]/edit` page, `creative-edit-form.tsx`, and the
  `updateCreative` action were DELETED — don't reintroduce them. Notes stay on
  their own inline editor (`updateCreativeNotes` via NotesPanel); `patchCreative`
  never touches notes. Tag editing uses `tag-multi-select.tsx` (a Popover
  dropdown), and the publish date uses a Calendar popover.
- **Theming = one axis, eight THEMES** — five dark (Midnight / Slate /
  Carbon / Contrast / Ocean) + three light (Sand / Frost / Rose). Each theme
  also sets its own accent (`--brand` / `--brand-2` + matching
  `--primary-foreground`), so the dominant UI color changes per theme; only the
  platform + pos/neg/warn chart colors stay shared. Managed by
  next-themes (`attribute="class"`, `storageKey="cw-theme"`,
  `defaultTheme="midnight"`, `enableSystem={false}`) → `class="<theme>"` on
  `<html>`. Midnight is the base palette in `:root`; every other theme is a
  `.<name>` class that overrides ONLY the surface/ink/line scale (Sand also
  re-tunes pos/neg/warn + popover since it's light). Brand magenta, the five
  platform colors, and (for the dark themes) pos/neg/warn are shared so the
  charts/graphs look identical across themes — only the chrome re-tones. The
  `dark:` variant matches the seven dark theme classes; **Sand is excluded**
  so shadcn renders its light base styles there. This REPLACED the old
  light/dark + 5-accent model (accent-provider.tsx / accents.ts deleted) — the
  accent hue swaps were cosmetically pointless. To add a theme: add a `.<name>`
  palette override (+ pos/neg/warn if light), add the name to `THEMES` in
  layout.tsx, add it to `@custom-variant dark` if dark, and add an entry in
  theme-toggle.tsx. A second, orthogonal axis is the **UI font**: `data-font`
  on `<html>` (`cw-font` in localStorage, applied pre-paint by the inline
  script in layout.tsx) picks `--font-ui` among three next/font families
  (`--ff-jakarta` default / `--ff-inter` / `--ff-grotesk`). Body uses
  `var(--font-ui)`; headings keep the Instrument Serif display
  (`--font-display` → `--ff-serif`). Both axes live in the one ThemeToggle
  dropdown.
- **Upload UPSERT mode** (the New-upload `upsert` toggle). The normal
  import (`runPipeline`) still defaults to strict insert: a row already in the
  DB → E051 reject (guards against re-uploading the wrong file). With the
  toggle ON, the validate route runs the SAME full validation but skips the
  E051 check, then partitions the validated rows against the table's unique
  identity `(creative, platform, campaign ➤ adset, date)` into **inserts**
  (new) and **updates** (existing, by record id). The commit inserts the new
  rows under one batch and UPDATEs the existing rows in place (full-row,
  last-value-wins; video columns null for non-video). Built for TikTok-style
  attribution backfill — re-upload the rolling window each day, existing days
  get their back-attributed conversions, the newest day is inserted. Because
  upsert reuses the import validation, the file must carry ALL mapped columns
  (a full export), not a partial one. Updates overwrite in place, so they're
  NOT rollback-able like an insert batch (the batch-rollback only undoes the
  inserted rows). Audit: `upload.commit` with meta `{rowsImported, rowsUpdated,
  upsert:true}`.
- **Screenshot-to-clipboard** lives in the top bar (`components/layout/
  screenshot-button.tsx`). It renders the live page DOM to a PNG via
  `modern-screenshot` (dynamically imported, so it's not in the initial
  bundle; chosen over html2canvas because the SVG-foreignObject path renders
  this app's CSS variables / `color-mix()` correctly) and writes it to the
  clipboard with the async Clipboard API (HTTPS + a user gesture, both
  satisfied), falling back to a file download otherwise. It captures the whole
  page (`document.body`); nodes with `data-screenshot-exclude` (the button
  itself) and the sonner toaster are filtered out. A browser web app CANNOT
  silently capture the OS desktop — that needs `getDisplayMedia`, which always
  shows a picker; this DOM-render path is the no-prompt option.
- **Multi-tenancy = row-level `account_id`, scoped in the query/action layer
  (NOT a security boundary).** The app manages 2–5 brands from one DB; the
  active brand is the `ccms_account` cookie, resolved per request by the
  cache()-deduped `getActiveAccountId()` / `listAccounts()` / `getActiveAccount()`
  in `lib/tenant.ts` (mirrors `auth()`). Any signed-in user may switch to any
  brand via the top-bar `AccountSwitcher` (next to the title) or the **Brands**
  tab under `/admin/catalog`; `setActiveAccount`/`createAccount`/`renameAccount`
  live in `app/actions/account.ts`. Every tenant table carries `account_id`
  (FK → `accounts`, DEFAULT the Urjwan id `00000000-0000-0000-0000-000000000001`):
  products, creatives, tags, performance_records, upload_batches,
  upload_validation_sessions, summary_views, platform_field_mappings,
  audit_events, rating_rules (PK = account_id), platform_rating_rules
  (PK = (account_id, platform)). `creative_tags` has NO `account_id` — it's
  scoped transitively via its creative, so tag rename/delete **cascades must be
  bounded by a `creatives WHERE account_id` subquery** (else a shared tag string
  hits other brands). Reads: every `db/queries/*` condition-builder injects one
  `eq(table.accountId, await getActiveAccountId())`; writes: actions/routes stamp
  `accountId` on inserts and scope updates/deletes. The upload pipeline stores
  the account on the validation session and commits under THAT account (a
  mid-flow switch can't cross-write). `logAudit` stamps `account_id` (override
  param for the session-scoped upload audits). Single-account behaviour is
  unchanged because the filter = the only account = all rows. Migrations: **0013**
  (additive: accounts + `account_id` NOT NULL DEFAULT Urjwan + composite uniques —
  backward-compatible, deploy-safe alone) and **0014** (rating PK restructure —
  NOT backward-compatible: drops `rating_rules.id`, so it must land WITH the code,
  not before/after). Both applied to prod. To add a tenant table: add
  `accountId: accountId()`, scope its queries + writes, prefix any unique index
  with `account_id`. **A foreign-key target must be re-validated against the
  active account before a write** — the FK only enforces global existence
  (`creatives.product_id → products.id` is NOT a composite `(account_id,
  product_id)` FK), so an action writing a caller-supplied id must first look it
  up scoped to the account (see `productInAccount` in `app/actions/creative.ts`;
  the bulk-create path does the equivalent via an account-scoped name map). A
  multi-agent audit caught this on create/patchCreative after the initial ship.
- **Creative status is DYNAMIC (spend-derived), not a stored field.** The old
  manual `creatives.status` enum (draft/active/paused/archived) is retired —
  the column still exists but is **no longer read** (kept to keep migration 0015
  additive; a later cleanup can drop it). Status now = `New` (never spent
  anywhere) / `Active` (spent within the brand's window of a platform's OWN
  latest data day) / `Pause` (ran but not within the window) / `Terminated`
  (manual, sticky, **per creative×platform**, stored in `creative_platform_overrides`).
  Pure derivation lives in `lib/creative-status.ts` (`deriveCreativeStatus`,
  `STATUS_LABEL`/`STATUS_DOT`); the account-scoped query is
  `db/queries/creative-status.ts` (`creativeStatusMap(ids?)` + `statusFor`).
  **Per-platform status is anchored to each platform's own latest data day**
  (uploads are per-platform, so freshness differs per channel) — never a single
  global "today"/max-date. General status is a roll-up: `active` if active on any
  platform ▸ else `pause` ▸ else `terminated` (terminated everywhere it ran) ▸
  else `new`. The window is per-brand `accounts.status_window_hours` (default 24;
  daily-grain data rounds up to whole days, so 24h = the latest day only),
  editable in the Brands admin via `setStatusWindow`. Terminate/reactivate =
  `setCreativeTermination` (per creative×platform). Render with
  `<StatusBadge>`. The aggregate KPI views (Overview/Trends/Funnel/Compare)
  dropped their status filter (can't be a SQL WHERE); Library + Summary keep it
  (Summary's is platform-scoped). Summary's status column SORT is a JS re-sort
  over the DERIVED `generalStatus` (STATUS_ORDER), and the status column defaults
  to **asc on first click** (active→pause→new→terminated, so the most-relevant
  show first) via `firstDir()` in summary-table.tsx — NOT the dead legacy column.
  KNOWN GAP: the Library "status" column SORT may still order by the dead legacy
  column — switch to a JS sort on the derived value if you touch it. Migration
  0015 (additive: the overrides table + window column + archived→terminated
  backfill) is applied to prod.
- **Deleting a creative is a hard delete** (`deleteCreative`). It removes the
  creative's `performance_records` first (no cascade on that FK), then the
  creative (tags cascade). The confirm dialog
  (`components/creative/delete-creative-dialog.tsx`) shows the exact record
  count + per-platform breakdown + date range from `creativeDeletionSummary`,
  and an acknowledgement checkbox gates the destructive button. The audit row
  (`creative.delete`) survives because it stores a label, not an FK.
- **CSV internal fields have ONE source of truth — `csv/platforms/types.ts`.**
  Adding a metric the upload pipeline understands (e.g. `add_to_cart`,
  `add_payment`) means: (1) the schema column + migration, (2) `INTERNAL_FIELDS`
  + a `FIELD_META` entry (label + `required`) in `types.ts`, (3) each adapter's
  `headerMap` candidate, (4) `csv/pipeline.ts` parse + `ParsedRow`, (5) the
  commit route's `metricValues`. The mapping-admin UI (rows, add-header
  dropdown, platforms-readiness card) **derives** from `FIELD_LIST`/`FIELD_META`
  — do NOT re-list fields in those components. This was a real bug: those three
  UI components each kept their OWN hand-copied field list, so a new field
  landed in the pipeline but never showed in Configuration → CSV mapping. Fixed
  by making them read `FIELD_LIST`; the `Record<InternalField, …>` types on
  `FIELD_META` and every adapter `headerMap` now make the compiler REJECT any
  field that isn't described everywhere (verified by injecting a probe field →
  5 adapter errors + 1 FIELD_META error). New optional metrics go in
  `FIELD_META` with `required: false` so existing uploads keep validating.
- **The default date range is REMEMBERED per user (cookie), not fixed.** When a
  page has no explicit `from`/`to` in its URL it uses the `ccms_date_range`
  cookie — a preset key (e.g. `30`, kept ROLLING so it recomputes relative to
  today) or `custom:FROM..TO` (frozen dates). First-ever visit / unreadable
  cookie → last 7 days. The shared `DateRangePicker` writes the cookie on every
  pick (opt-in via its `remember` prop) and shows the remembered range as its
  label via a `fallback` prop (so the trigger matches the data — this also fixed
  a pre-existing mismatch where dashboards showed 30 days but the picker said "7
  days"). Pure decode/encode live in `lib/date-presets.ts`
  (`decodeRememberedRange`/`encodeRememberedRange`, unit-tested); the async
  server reader is `lib/date-range-cookie.ts` (`readRememberedRange` /
  `resolveRememberedRange`, read during SSR so there's no flash). Every
  date-filtered page resolves its window through those helpers and passes the
  resolved range to its filter bar as `defaultFrom`/`defaultTo`. Bars that opt
  in: FilterStrip, PortfolioFilterBar, SummaryFilterBar, AnalyticsDateFilter.
  Compare + Cleanup deliberately do NOT remember (they own special, non-global
  ranges). This replaced the old fixed defaults (dashboards 30d via
  `defaultDateRange(TRAILING_DAYS_DEFAULT)`, detail pages 7d via
  `resolveDefaultRange`, Summary all-time) — all now unified on the cookie. No
  DB/migration; the cookie is non-sensitive and per-browser.
