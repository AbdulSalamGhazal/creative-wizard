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
- Auth: custom HMAC-signed cookie sessions (`lib/auth-cookie.ts`) + bcrypt passwords (`lib/auth-password.ts`). Users created via `/admin/users`; first admin via `db/create-admin.ts`. NOT Auth.js/Google — those were never wired up. **Authorization is GRANULAR per-user permissions** (`lib/permissions.ts` catalog is the single source of truth) — see the Learned entry. Admins bypass every check; below admin, each capability is individually grantable and managed at `/admin/access`.
- Tailwind + shadcn/ui + shadcn charts (Recharts under the hood)
- papaparse (CSV), Zod (validation)
- Vercel hosting. Vercel KV is NOT used (upload-validation sessions live in Postgres). **Vercel Blob IS used** for creative thumbnails: uploaded via `POST /api/uploads/thumbnail` (requires `creative.edit`; client downscales→WebP first), stored public, and the returned URL is saved to `creatives.thumbnail_url`. Requires `BLOB_READ_WRITE_TOKEN` (auto-added when a Blob store is connected to the project); the blob host is allow-listed in `next.config.ts` `images.remotePatterns`.

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
- `performance_records` is **unique** on `(creative_id, platform, campaign_id, date)` — the same creative can run on the same platform/date across different campaigns (distinct rows), but not the same campaign twice. (`campaign_id` is the FK to the campaigns registry; the old `campaign_name` text column is gone — see the Learned section.) Validation is still the only **entry** path. There are four sanctioned **exit** paths (each gated by a granular permission — see the Learned entry; admins always pass): (1) batch rollback within 24 h (`upload.rollback`), (2) the record-cleanup tool on `/uploads` (filtered hard-delete, `upload.cleanup`, preview-then-confirm, audit-logged via `upload.bulk_delete`), (3) deleting a creative (`deleteCreative` in `app/actions/creative.ts`) — which removes that creative's records inside a transaction because `performance_records.creative_id` has NO `ON DELETE CASCADE`, then deletes the creative (its `creative_tags` cascade). `creative.delete`, confirm-with-record-summary, audit-logged via `creative.delete`, and (4) deleting a campaign (`deleteCampaign` in `app/actions/campaign.ts`) — the campaign detail page's danger zone; because `performance_records.campaign_id` also has NO `ON DELETE CASCADE`, it removes the campaign's records inside a transaction, then drops the `campaigns` row. The CREATIVES that ran in the campaign are KEPT (only their records for that campaign go); confirm-with-record-summary (`campaignDeletionSummary`), `campaign.delete`, audit-logged via `campaign.delete`. No other code should delete from `performance_records`.
- Every creative has a required `product_id`. Products live in their own table and are managed in `/admin/catalog?tab=products`. Never let a creative be saved without one.

## Aggregation rules (CRITICAL)

- Every blended or aggregated metric is computed as a **weighted average via component sums** — never as a mean of per-row ratios. `SUM(clicks) / NULLIF(SUM(impressions), 0)`, never `AVG(clicks::numeric / impressions)`.
- All derived-metric SQL fragments are imported from `lib/metrics.ts`. Do not open-code them in `db/queries/*`. If the formula needs to change, change it in `lib/metrics.ts` and every dashboard updates.
- Use `NULLIF(divisor, 0)` so undefined values render as `NULL` → `—` in the UI, not as `0` or `Infinity`.
- All aggregation queries apply `WHERE excluded_from_aggregates = false` by default. The `?includeExcluded=1` URL param flips this for diagnostic views. Detail pages always show every record with an "Excluded" badge.

## Validation rules (from validation-spec.md)

- The CSV pipeline is 5 stages. Do not reorder them.
- Stages 1–2 fail fast. Stages 3–5 collect errors.
- Creative-name matching is **trim-then-exact** — cells are whitespace-trimmed, then matched byte-exactly (case-sensitive, NO Unicode normalization). Blank/`-`/`—`/`N/A`/`null` numeric cells read as `0` in every numeric column; a required numeric field errors only when its COLUMN is absent (E010), never per blank cell. (v1.2 decision — see validation-spec §4/§5.1.)
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

> **Docs are part of the change, not an afterthought.** Any change that alters
> behavior described in `docs/*` or in this file MUST update the affected document
> in the same commit — a PR/session that changes validation, schema identity, auth,
> tenancy, deletion paths, or metrics without a matching doc edit is incomplete.
> When code and a doc disagree, do not silently pick a side: fix the doc or flag
> the conflict. At the end of any session that shipped a feature, re-read the doc
> sections it touches and correct drift. Docs must stay clean, current, and
> non-contradictory — the Learned section may add nuance, but the rules sections
> above it must never state something the Learned section contradicts.

## Deployment (production) — LIVE

This app is deployed and in production use. Treat `main` as shippable.

- **Host:** Vercel, GitHub-integrated. Remote `origin` = `git@github.com:AbdulSalamGhazal/creative-wizard.git`. **Pushing to `main` auto-deploys** (`next build`); a failed build keeps the previous version serving (zero downtime).
- **URL:** https://creative.urjwan.com (custom domain, Let's Encrypt TLS, auto-renew). The `*.vercel.app` URL also resolves but Google Safe Browsing false-flags the shared domain — always use the custom domain.
- **Health check:** `GET /api/health` (public, no auth) → `200 {status:"ok"}` when the DB is reachable, `503 {status:"degraded"}` when not. Point an uptime monitor at it. The DB client (`lib/db.ts`) has `connect_timeout: 10` so an unreachable DB fails fast and surfaces the `(dashboard)/error.tsx` boundary (calmer "temporarily unavailable" copy for connection errors) instead of hanging; route errors `console.error` → visible in Vercel logs.
- **Database:** Neon Postgres (eu-central-1). Two connection strings:
  - **Pooled** (host contains `-pooler`) → this is `DATABASE_URL` in Vercel. Required because `lib/db.ts` uses `max: 1` per serverless instance.
  - **Direct** (no `-pooler`) → used ONLY to run migrations.
- **Vercel env vars:** `DATABASE_URL` (pooled), `AUTH_SECRET`, and `BLOB_READ_WRITE_TOKEN` (creative thumbnails live in Vercel Blob — see the Stack section; the token is auto-added when the Blob store is connected). Nothing else (no Google SSO vars, no KV). Local copies of all prod secrets live in gitignored `.env.production.local` — never commit it, never paste it into committed files.
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

- **Forgiving CSV matching is INTENTIONAL as of 2026-07 (validation-spec v1.2).**
  The pipeline trims cells then matches creative names byte-exactly (case-
  sensitive, no NFC), and reads blank/`-`/`—`/`N/A`/`null` numeric cells as `0`
  in every numeric column (E042 is for blank identity fields — date/campaign_
  name/adset_name — only; a missing required column is E010). This was a
  deliberated product decision, NOT a bug — do **not** "fix" `csv/pipeline.ts`
  back to strict-with-NFC or make blank numeric cells raise E042. The spec was
  amended to match the code (not the reverse).

- **`next build` fails on `react/no-unescaped-entities` — `tsc`/typecheck does
  NOT catch it.** A raw apostrophe/quote in JSX *text* (e.g. `that platform's
  day`) is an ESLint **error** that fails `next build` (and therefore the Vercel
  deploy), even though `npm run typecheck` is green. Escape as `&apos;`/`&rsquo;`
  or reword. When verifying a deploy, **never trust `npm run build | tail -n`** —
  the "Failed to compile" line scrolls above the tail window and looks like a
  success. Check the exit code and `grep -iE "failed to compile|Error:"` on the
  full log. A failed Vercel build silently keeps serving the previous deploy, so
  prod looks "not updated" with no error surfaced.

- **Campaign identity = `performance_records.campaign_id` FK (normalized).** A
  perf row's campaign is a FK to the `campaigns` registry — NOT a text column.
  (The old denormalized `campaign_name` text was dropped in migrations 0023
  expand / 0024 contract; reads `JOIN campaigns` and source the display name from
  `campaigns.name`, writes resolve `campaign_id` from the registry by
  `(account_id, built-name)`.) The registry name is the combined `Campaign ➤
  Adset` value — and for **instagram/facebook** a short platform tag is appended
  (e.g. `Holiday ➤ Broad (IG)` / `(FB)`) so the same Meta campaign split across
  the two stays distinct. That name format is built ONLY through
  `lib/campaign.ts` `buildCampaignName()` (the `PLATFORM_TAG` map; used by the
  CSV pipeline, the create-campaign action, and the seed) — don't open-code it.
  Because a renamed/​re-tagged campaign is now a single-row update to
  `campaigns.name` (every perf row follows via the FK), there's no bulk
  campaign_name rewrite anymore; the one-off `shorten-platform-tags.ts` that did
  the `(Instagram)→(IG)` rewrite was deleted post-normalization. Duplicates are
  keyed on `(creative, platform, campaign_id, date)` and rejected via E050
  (intra-file) / E051 (already-imported, joins `campaigns`) plus the
  `perf_creative_platform_campaign_id_date_idx` unique index. The same creative
  across *different* campaigns on the same day is allowed.
- The admin record-cleanup tool (`/uploads`, `app/actions/cleanup.ts`) is a
  sanctioned hard-delete exit path for `performance_records`, added at the
  user's request. It overrides the original "rollback is the only exit path"
  rule. Gated by the `upload.cleanup` permission. Guardrails: ≥1
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
- **Theming = one axis, FOUR THEMES** — two dark (**Midnight** default /
  **Contrast**) + two light (**Frost** cool blue-white / **Paper** warm cream).
  (2026-07: slimmed from eight — Slate/Carbon/Ocean/Sand/Rose were deleted and
  Paper added so the two light options read differently.) Each theme also sets
  its own accent (`--brand` / `--brand-2` + matching `--primary-foreground`), so
  the dominant UI color changes per theme; only the platform + pos/neg/warn
  chart colors stay shared. Managed by next-themes (`attribute="class"`,
  `storageKey="cw-theme"`, `defaultTheme="midnight"`, `enableSystem={false}`) →
  `class="<theme>"` on `<html>`. Midnight is the base palette in `:root`; every
  other theme is a `.<name>` class that overrides the surface/ink/line scale
  (the two light themes also re-tune pos/neg/warn + popover + the data-viz vars).
  Brand magenta and the four platform colors are shared so the charts look
  consistent — only the chrome re-tones. The `dark:` variant matches ONLY the
  dark classes (`.midnight, .contrast`); the light themes (Frost / Paper) are
  excluded so shadcn renders its light base styles there.
  - **Data-viz on light themes:** the grouped `.frost, .paper` block in
    `app/globals.css` overrides every series/product/type var (and tiktok +
    snapchat) with the ~600-level darker sibling so lines/swatches stay legible
    on white (verify new light data colors here).
  - **To add a theme:** add a `.<name>` palette override (+ pos/neg/warn +
    popover + the light-viz vars if light), add the name to `THEMES` in
    layout.tsx, add it to `@custom-variant dark` **only if dark**, add it to the
    `ok` valid-set in layout.tsx's stale-theme migration script, add an entry in
    theme-toggle.tsx (swatches mirror globals.css), and (if light) to
    `LIGHT_THEMES` in themed-toaster.tsx. Verify brand-on-surface and body
    ink-on-surface hit AA.
  - **Stale-theme migration:** a pre-paint inline script in layout.tsx maps any
    stored `cw-theme` that no longer exists BEFORE next-themes reads it —
    slate/carbon/ocean → midnight, sand/rose → frost, anything unknown →
    midnight (else the dangling class would silently render Midnight tokens
    while `dark:` no longer matched → broken mix). The same script drops the
    now-dead `cw-font` key.
- **ONE UI font — no font switcher.** Plus Jakarta Sans is the only UI font
  (`--ff-jakarta`, which `--font-ui`/`--font-sans` point straight at);
  Instrument Serif is the display/heading font (`--font-display`); IBM Plex Mono
  is the mono. (2026-07: the old `data-font` axis with Inter / Space Grotesk was
  removed — dead vars, the `[data-font]` selectors, the `cw-font` key, and the
  ThemeToggle font section all deleted.)
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
  **Per-platform status is anchored to each platform's own latest SPEND day**
  (the latest day with `spend > 0`; the freshness query matches the activity
  query's `spend > 0` so a trailing $0 day can't mislabel a recent spender as
  Pause — uploads are per-platform, so freshness differs per channel) — never a
  single global "today"/max-date. General status is a roll-up: `active` if active on any
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
  The Library "status" sort likewise re-sorts in JS by the derived status
  (STATUS_ORDER in db/queries/creatives.ts). Migration
  0015 (additive: the overrides table + window column + archived→terminated
  backfill) is applied to prod.
- **Campaign status is DYNAMIC too — 2-state (Active/Inactive), purely derived,
  NO override, NO schema.** Parallels creative status but simpler: a campaign is
  `active` if its last real-spend day (`spend > 0`, non-excluded) is within the
  brand's window of its platform's OWN latest spend day, else `inactive`
  (includes never-spent). Same window (`accounts.status_window_hours` →
  `hoursToWindowDays`) and same per-platform freshness anchor as creative status,
  and likewise computed over ALL data (current liveness), NOT the selected date
  range. Derivation: `lib/campaign-status.ts` (`deriveCampaignStatus`,
  `CAMPAIGN_STATUS_LABEL`/`_DOT`/`_ORDER`, reuses the now-exported `isoMinusDays`
  from `lib/creative-status.ts`); account-scoped query
  `db/queries/campaign-status.ts` (`campaignStatusMap(ids?)` — two scans:
  per-`(campaignId, platform)` last-spend-day + per-platform freshness — rolls up
  active-if-any-platform for the rare untagged multi-platform campaign; +
  `campaignStatusFor` defaulting to `inactive`). Rendered by
  `<CampaignStatusBadge>` on the **campaigns table** (a sortable/CSV Status column
  between Objective and Platform) and the **campaign detail** header. Because it's
  derived it CAN'T be a SQL WHERE — the `statuses` filter (URL-backed dropdown in
  `portfolio-filter-bar.tsx`, validated via `csvEnum(CAMPAIGN_STATUSES)`) is
  applied in the query layer (`portfolioCampaigns` filters the rows after
  attaching status), same as Library/Summary creative-status filters.
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
- **Shared UI primitives — DO NOT re-implement these per surface.** A
  consistency pass unified table + chart-control patterns that had drifted
  (each page had grown its own). Use them for any new table/chart:
  - **Tables → `components/ui/data-table.tsx` (`DataTable<T>`).** The canonical
    flat-column table: controlled sort (`sort`/`dir` + `onSort`), drag-grip
    reorder (`order` + `onReorder`), drag-edge resize (internal/ephemeral),
    externally-controlled column visibility (`hidden`), Summary-style borders
    (`border-l` between columns + `divide-y` rows), sticky header/footer +
    sticky pinned first column, optional totals (`showTotals`), `onRowClick`,
    `rowClassName`. Columns are a typed config (`DataColumn<T>`:
    key/label/align/sortable/pinned/render/total/sortValue/defaultSortDir). The
    consumer owns sort/order/hidden state and backs it with the URL (for saved
    views — see the campaigns table) **or** local state (detail tables). On it:
    the **Campaigns** table (`portfolio-table.tsx`, URL-backed + views),
    **By-tag** (`tag-rollup-table.tsx`), **Video** (`video-diagnostics-table.tsx`),
    the **campaign row-data** table (`campaign-records-table.tsx`), and the
    creative-detail **campaigns/platform** table (`creative-campaigns-table.tsx`,
    local sort + a By campaign / By platform mode toggle; totals derived from
    component sums so they match across modes; row-click → campaign detail). The
    Columns dropdown lives in each consumer's toolbar and drives `hidden`. (The
    old hand-rolled `creative-platform-table.tsx` — expandable per-platform rows —
    was replaced by this and DELETED.)
  - **THE ONE EXCEPTION: the Summary table** (`summary-table.tsx`) is NOT on
    DataTable and shouldn't be forced onto it — its columns are per-platform
    GROUPS (a grouped header row), not flat columns, so it reorders/hides at the
    group level. It already shares the same visual language (borders, sort
    arrows, resize handle) — DataTable's border style was derived from it. Leave
    its structure; only keep the look in sync.
  - **Chart metric pick → `components/charts/metric-picker.tsx` (`MetricPicker`)**
    — one segmented control (wraps when many options). Replaced the old mix of
    native `<select>`, shadcn `<Select>`, and ad-hoc pill/segment groups. On it:
    campaign creative chart, trends type×platform, metric-over-time,
    creative-perf-line.
  - **Chart series legend → `components/charts/series-legend.tsx`
    (`SeriesLegend`)** — one toggle-chip legend for show/hide series (funnel rate
    lines, campaign creative lines).

- **Global navigation progress bar.** App Router has no route-change events, and
  same-route filter/date/sort changes navigate via `useTransition` — which keeps
  the current page visible with NO built-in spinner (reads as "nothing
  happened" on a slow query). Fix: a thin brand top bar (`NavProgressBar` in the
  dashboard layout) driven by the `navProgress` store in `lib/nav-progress.ts`.
  Any component that drives a route/searchParam change must use
  **`useNavTransition()`** (a drop-in `useTransition` that reports its pending
  state to the store) instead of React's `useTransition`, OR wrap a bare
  `router.push`/`replace` in the `startTransition` it returns (see
  `portfolio-table.tsx`). All the filter bars, the date picker's parents,
  views-control, metric-filter, and the campaigns table already do. New nav
  components: use `useNavTransition` or they won't show the loading bar.

- **UI consistency pass (2026-07, COMPLETE — one sub-item deferred) added
  shared primitives; a fresh session must REUSE these, not re-invent them.**
  - **Data-viz colors are theme-aware CSS vars, driven from `lib/palette.ts`.**
    Series/product/type/platform colors are now `var(--series-N)` /
    `var(--product-N)` / `var(--type-*)` / `var(--instagram|facebook|tiktok|
    snapchat)` — NOT hex literals. `:root` holds the dark (400-level) values;
    the grouped `.frost, .paper` block in `app/globals.css` overrides each
    with a ~600-level darker sibling so charts stay legible on white. Recharts
    resolves `var()` in `fill`/`stroke`, and inline `style` resolves it too, so
    consumers just read the palette exports. Any NEW data color = a CSS var with
    a light-theme override (verify on Midnight + Frost + Paper + Contrast).
  - **`FUNNEL_METRIC_COLOR`** (lib/palette) is the single color-per-funnel-metric
    map (cpm/ctr/voc/atcRate/apRate/purchaseRate/cvr) — the dashboard funnel-rates
    card and the /funnel tiles + trend chart all read it; none collides with a
    platform hue. **`roas()`** in `lib/format` renders ROAS with the `×` suffix —
    use it everywhere ROAS shows.
  - **`PlatformDot`** (`components/ui/platform-dot.tsx`, size `sm|md`) is the
    canonical platform swatch — every hand-rolled dot span (charts, admin +
    detail tables, funnel, upload picker) is now on it; the only remaining
    `PLATFORM_COLOR` inline styles are the two per-platform progress BARS.
    **Nav is one source:** `components/layout/nav-items.ts`
    (`NAV_ITEMS`/`isActive`) drives BOTH the desktop `Sidebar` and the mobile
    `MobileNav` (hamburger + Sheet, `lg:hidden`, in the TopBar).
  - **`middleware.ts`** is the real auth boundary (Edge Web-Crypto HMAC verify of
    the `ccms_session` cookie); the dashboard layout check is now belt-and-braces.
  - **`MetricCard` has an `empty` prop** that suppresses the delta chip (no more
    red "Gone" on an empty range). All sticky filter bars sit at `top-14 z-10`.
  - **Page shell = `PageShell` + `PageHeader`** (`components/layout/`). Every
    route renders `<PageShell>` (space-y-6 + a width lane: `full`/`admin`=4xl/
    `form`=2xl/`import`=3xl + an optional full-bleed `filterStrip` slot that owns
    the old `-mx-6 -mt-6` hack) wrapping `<PageHeader eyebrow? backLink? title
    subtitle? rightSlot?>`. Don't hand-roll a page header or the filter-strip
    full-bleed again.
  - **Every route ships a tailored `loading.tsx`** composed from
    `components/layout/page-skeletons.tsx` (FilterStrip/FilterBar/Header/KpiRow/
    ChartCard/Table skeletons) — mirror the real page's shape, not a generic box.
  - **`ChartTooltip`** (`components/charts/chart-tooltip.tsx`) is the one Recharts
    tooltip surface (frosted popover); pass `className` for a width cap.
  - **shadcn `Card` is retheme'd** to `bg-surface`/`border-line`/`rounded-lg` +
    the p-4 (16px) padding system — DON'T re-add `className="bg-surface
    border-line"`. It and the hand-rolled `rounded-lg p-4` panels are now one
    system.
  - **Two micro-label tokens** in globals.css: `text-eyebrow` (10px/0.18em) and
    `text-label` (11px/0.14em). Use these, not ad-hoc `text-[10/11px] uppercase
    tracking-[…]`. Snap arbitrary `text-[12/13px]` to `text-xs`.
  - **`lib/metric-labels.ts` (`METRIC_LABEL`)** is the single source for metric
    column labels (Impr./Conv./Revenue …) — tables read it, never re-spell.
  - **`lib/format` additions:** `monthDay()` (UTC "Mon D"), `usdCompact`/
    `intCompact` (no private per-chart `Intl` copies). Dash (`—`) means NULL
    only — a real `0` renders as `0`/`$0` (usd/int already do this).
  - **Forms:** shadcn `Select` + `Label` via a local `Field` helper (model:
    `creative-create-form`). Form-level errors render INLINE in the bordered
    banner (`rounded-md border border-neg/30 bg-neg/5 …`); toasts are for
    row/background mutations only (curly `“…”` quotes). Real `<form onSubmit>`
    so Enter submits; never put `disabled` on an `asChild` `<Link>`.
  - **New surfaces MUST use the shared primitives** — PageHeader/PageShell,
    Panel/Card, DataTable, MetricPicker, SeriesLegend, ChartTooltip, PlatformDot,
    DeltaBadge, DownloadCsvButton, `lib/format` (incl. `roas()`/`monthDay`),
    `lib/palette` (incl. `FUNNEL_METRIC_COLOR`), `lib/metric-labels`
    (`METRIC_LABEL`) — never a hand-rolled local variant. Any new color is a CSS
    var with light-theme overrides verified on Midnight/Frost/Contrast; any new
    page ships its own tailored `loading.tsx` and works at 375px. If a primitive
    doesn't fit, EXTEND it — don't fork it.
  - **DEFERRED (its own session):** migrate `campaign-funnel-table.tsx` (330 loc,
    own sort + drag-resize) and `launch-fatigue.tsx` (734 loc) onto `DataTable`.
    These are large rewrites of live tables and warrant a dedicated, carefully-
    verified change rather than being bundled into the consistency sweep.

- **Authorization is GRANULAR per-user permissions (2026-07) — DERIVE from the
  catalog, never re-list.** The old two-tier `requireEditor`/`requireAdmin` model
  is GONE. `lib/permissions.ts` is the single source of truth: `PERMISSION_GROUPS`
  (an `as const` catalog of 5 groups / 17 keys) → the `Permission` union +
  `ALL_PERMISSIONS` are derived from it, so any new capability is added in ONE
  place and every surface (checks, the `/admin/access` UI, nav) follows.
  - **Storage:** `users.role` (`admin` | `editor` | `viewer`, a tier) +
    `users.permissions text[]` NULLABLE (migration 0026, additive). `NULL` →
    derive from the role preset; a non-null array → an explicit ("Custom") grant.
    `resolvePermissions(role, permissions)`: admin → ALL; null → preset; array →
    the filtered explicit set (role tier is cosmetic below admin when the array
    is present). Presets: admin = everything, editor = `EDITOR_PRESET` (today's
    old `requireEditor` set EXACTLY — creative/campaign CRUD, import/upsert/
    cleanup, exclude), viewer = none.
  - **Enforcement (the server IS the boundary):** every mutating action/route
    calls `requirePermission(<perm>)` from `lib/auth.ts` (throws otherwise);
    admins bypass via `can()`. The 3 upload routes: validate/commit →
    `upload.import`, and re-check `upload.upsert` when `upsert` is on;
    thumbnail → `creative.edit`. `can(user, perm)` is pure+sync so Server
    Components gate rendered UI with it.
  - **UI gating is UX-only (hide, don't disable-only).** A `PermissionsProvider`
    (`components/auth/permissions-context.tsx`) seeded from the layout exposes
    `useCan(perm)` to Client Components; server pages/danger-zones gate with
    `can(user, perm)`. Nav derives visibility via `visibleNavItems()` in
    `nav-items.ts` (per-item `perms`, shown if the user holds ANY). Never rely on
    hidden UI for security — the action/route check is the real gate.
  - **`/admin/access`** (`users.manage`) manages role+permissions per user:
    preset selector (Admin/Editor/Viewer/Custom) + group checkbox grids + a dirty
    Save/Discard bar; admin cards render all-checked+disabled; you can't edit your
    OWN access. `updateUserAccess` in `app/actions/user.ts` enforces the
    guardrails (no self-edit, can't demote the last admin) and audits
    `user.permissions_update` with before/after `{role, permissions}`. The
    invite/role flows accept `viewer` too.
