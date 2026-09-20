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
- Auth: custom HMAC-signed cookie sessions (`lib/auth-cookie.ts`) + bcrypt passwords (`lib/auth-password.ts`). Users created via `/admin/users`; first admin via `db/create-admin.ts`. NOT Auth.js/Google — those were never wired up. **Authorization is GRANULAR per-user permissions** (`lib/permissions.ts` catalog is the single source of truth) — see the Learned entry. Admins bypass every check; below admin, each capability is individually grantable and managed on the unified **Team** page (`/admin/users`).
- Tailwind + shadcn/ui + shadcn charts (Recharts under the hood)
- papaparse (CSV), Zod (validation)
- **`@xyflow/react` (React Flow), EXACT-pinned `12.11.6`** — the one dependency added in months, user-approved. Justification: *purpose-built node canvas (pan/zoom/minimap/focus) for the Canvas page; hand-rolling it is weeks of work.* It is imported by ONE module (`components/canvas/canvas-flow.tsx`) and loaded with `next/dynamic` (`ssr: false`), so it ships as a lazy chunk on `/canvas` only — see the Canvas entry under Learned.
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
- `performance_records` is **unique** on `(creative_id, platform, campaign_id, date)` — the same creative can run on the same platform/date across different campaigns (distinct rows), but not the same campaign twice. (`campaign_id` is the FK to the campaigns registry; the old `campaign_name` text column is gone — see the Learned section.) Validation is still the only **entry** path. There are four sanctioned **exit** paths (each gated by a granular permission — see the Learned entry; admins always pass): (1) batch rollback within 24 h (`upload.rollback`), (2) the record-cleanup tool on `/uploads` (filtered hard-delete, `upload.cleanup`, preview-then-confirm, audit-logged via `upload.bulk_delete`), (3) deleting a creative (`deleteCreative` in `app/actions/creative.ts`) — which removes that creative's records inside a transaction because `performance_records.creative_id` has NO `ON DELETE CASCADE`, then deletes the creative (its `creative_angles` cascade). `creative.delete`, confirm-with-record-summary, audit-logged via `creative.delete`, and (4) deleting a campaign (`deleteCampaign` in `app/actions/campaign.ts`) — the campaign detail page's danger zone; because `performance_records.campaign_id` also has NO `ON DELETE CASCADE`, it removes the campaign's records inside a transaction, then drops the `campaigns` row. The CREATIVES that ran in the campaign are KEPT (only their records for that campaign go); confirm-with-record-summary (`campaignDeletionSummary`), `campaign.delete`, audit-logged via `campaign.delete`. No other code should delete from `performance_records`.
- Every creative has a required `product_id`. Products live in their own table and are managed on the Library's **Products** tab (`/library?tab=products`). Never let a creative be saved without one.

## Aggregation rules (CRITICAL)

- Every blended or aggregated metric is computed as a **weighted average via component sums** — never as a mean of per-row ratios. `SUM(clicks) / NULLIF(SUM(impressions), 0)`, never `AVG(clicks::numeric / impressions)`.
- All derived-metric SQL fragments are imported from `lib/metrics.ts`. Do not open-code them in `db/queries/*`. If the formula needs to change, change it in `lib/metrics.ts` and every dashboard updates.
- Use `NULLIF(divisor, 0)` so undefined values render as `NULL` → `—` in the UI, not as `0` or `Infinity`.
- All aggregation queries apply `WHERE excluded_from_aggregates = false` by default. The shared Excluded toggle (`?includeExcluded=1|0`) flips this per page — the toggle sits on EVERY aggregate surface, and its state is a saved per-user preference (`users.include_excluded`; resolution: explicit URL param → saved pref → hidden, via `resolveIncludeExcluded`). Detail pages always show every record with an "Excluded" badge. **The flag itself has exactly TWO sanctioned writers:** the manual per-record action (`excluded_source='manual'`) and the exclusion-rules engine (`'rule'` + `excluded_rule_id`) — nothing else may flip it.

## Validation rules (from validation-spec.md)

- The CSV pipeline is 5 stages. Do not reorder them.
- Stages 1–2 fail fast. Stages 3–5 collect errors.
- Creative-name matching is **trim-then-exact** — cells are whitespace-trimmed, then matched byte-exactly (case-sensitive, NO Unicode normalization). Blank/`-`/`—`/`N/A`/`null` numeric cells read as `0` in every numeric column; a required numeric field errors only when its COLUMN is absent (E010), never per blank cell. (v1.2 decision — see validation-spec §4/§5.1.)
- All-or-nothing: nothing is written to `performance_records` unless the entire file is clean and the user confirms.
- Every error has a code from a catalog — now TWO of them: `csv/errors.ts` (E-codes, ads performance uploads) and `store/errors.ts` (S-codes, Store order uploads). Never invent ad-hoc error messages; pick the catalog for the domain.

## UI rules

- The dashboard must feel polished. Every page has tailored skeletons. Empty states are designed-out, not blank.
- Use shadcn primitives. Don't reinvent components that exist.
- Every new route sets a `metadata.title` (matching its sidebar/h1 label); detail routes use `generateMetadata` over a `cache()`-deduped query so the tab title and the page share one fetch. The root layout's `%s · Wizard` template adds the suffix — don't repeat it, and never add a `metadata.icons` key (the tab icon is the `app/icon.png` file convention).
- **Store module (2026-07) — a **Store** sidebar section split into `/store/uploads` (upload history + `/new` flow) and `/store/orders` (orders table); `/store` redirects to `/store/orders`. Manual Salla order uploads, PARALLEL to the ads pipeline (never touch `csv/`, `upload_batches`, `performance_records` for it).** Own error catalog `store/errors.ts` (S-codes; reuses `csv/parse.ts` for parsing only), EXPLICIT header mapping from `store_order_fields.headers` (case-insensitive trim, no auto-detect). Grain = one order (`store_orders`); exactly 3 CORE fields (`order_id`/`order_date`/`total_amount`) locked by `CORE_KEYS` in `store/fields.ts` — only label + headers editable, seeded per account (migration 0030 + `createAccount`). Custom fields → `attributes` jsonb. Upsert toggle like the ads upload; rollback deletes a batch's INSERTS only (updates keep their original `upload_batch_id`). **Currency is SAR, module-local (`sar()` in `lib/format.ts`) — NEVER convert to USD here** (ad-spend blending is a later phase). Config = the **Order fields** tab on `/store/uploads` (`config.store`); upload = `store.upload`. Migration 0030 (additive: `store_orders`/`store_order_fields`/`store_upload_batches` + core seed). Orders table is server-paginated (100/page) — never an unbounded query. **Every defined field is offered in the Orders Columns menu** (viewer's per-browser choice, persisted as a HIDDEN-key set so new fields default visible); the per-field `show_in_table` toggle was RETIRED 2026-08 (column kept dead, no longer read — like `creatives.status`; don't reintroduce reads). **Sanctioned `store_orders` delete paths = batch rollback + the order-cleanup tool** (`/store/uploads`, `store.cleanup`, in the editor preset): filtered hard-delete (date range / batch / order-id[s], ≥1 required), preview → type-DELETE-to-confirm → account-scoped transactional delete, audited `store.bulk_delete` (count from the actual DELETE, never an empty `inArray`) — mirrors the ads `upload.cleanup` tool. No other code deletes from `store_orders`.
- **MCP server (2026-07) — `/api/mcp/mcp`, bearer-authed, strictly READ-ONLY.** A remote MCP server (`mcp-handler`, route `app/api/mcp/[transport]/route.ts`) lets each user connect their own LLM to read-only analytics. Auth = personal access tokens (`api_tokens`; `lib/api-token.ts` — SHA-256 stored, raw `cwz_…` shown once, constant-time verify, revoke); `/api/mcp` is EXCLUDED from `middleware.ts` (its own bearer gate). Cookieless tenancy: `runWithTenant(accountId, userId, fn)` (`lib/tenant.ts` + `lib/tenant-context.ts` ALS) that `getActiveAccountId()`/`auth()` consult first — validates the account is ALLOWED for the user. **Add a tool ONLY via the registered-tool pattern in `lib/mcp/tools.ts`: a Zod input schema + `withBrand` + reuse a `db/queries/*` fn (never raw SQL), compact JSON out with a `{brand,range}` echo. NEVER add a mutating tool** (v1 is read-only; the whole design assumes it). Endpoint is `/api/mcp/mcp` (mcp-handler appends the transport segment to the `/api/mcp` basePath), not `/api/mcp`. Migration 0029 (additive `api_tokens`). OAuth 2.1 web-connector flow is a deliberate Phase-2 non-goal.
- Tabular figures (`font-variant-numeric: tabular-nums`) on every number in tables.
- USD formatting: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.
- Dates: ISO format in tables, friendlier formats in chart tooltips and headers.

## Never

- Never write to `performance_records` without a parent `upload_batches` row.
- Never bypass the validation pipeline. No admin "force import" feature.
- Never compute a blended metric as `AVG(ratio)` — always `SUM(numerator) / NULLIF(SUM(denominator), 0)`.
- Never bypass the `excluded_from_aggregates = false` filter in aggregation queries unless the resolved Excluded toggle (URL param or saved user preference) explicitly opts in.
- Never let a creative be saved without a `product_id`.
- Never store secrets in code or in client-side bundles.
- Never modify an uploaded CSV file on disk.
- Never use `any` to silence TypeScript.
- Never run `prisma` or `sequelize` commands — this project uses Drizzle.

## Workflow

- Make small, reviewable changes. One feature per PR or session.
- Add a test alongside any non-trivial logic, especially in `csv/` and `db/queries/`.
- **Two test suites.** `npm test` (or `npx vitest run`) is the pure-unit suite —
  no DB, no docker, always safe in CI. `npm run test:db` is the **real-database**
  suite (`tests/db/**`, config `vitest.config.db.ts`): its globalSetup creates a
  dedicated **`ccms_test`** database on the local docker Postgres and runs the
  Drizzle migrations, then points `DATABASE_URL` at it. It NEVER touches `ccms`
  (dev) or prod. The default suite excludes `tests/db/**`, so a machine without
  docker still runs green. DB tests `vi.mock("@/lib/tenant")` to drive the active
  account (cookies are unavailable in vitest) and re-seed via
  `tests/db/fixtures.ts` `resetAndSeed()`; the fixtures pin the weighted-
  aggregation, `excluded_from_aggregates`, tenancy-isolation, and per-platform
  status-freshness invariants of `db/queries/*`.
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
> **When adding a `pgTable`, update §4's table count in the same commit**
> (`grep -c '= pgTable(' db/schema.ts` is the source of truth) — that heading has
> now gone stale twice.

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

- **Notifications (2026-09, phase 1 — the spine). Five invariants, all
  deliberate.** Per-user in-app notifications: a top-bar bell, `/notifications`
  (no sidebar entry — the bell is the way in), and routing configured on
  Configuration → Notifications. Migration **0043** (additive: `notifications`
  + `notification_routes`).
  1. **Producers write INSIDE the transaction of the thing they describe.**
     `notifyRoutes(tx, accountId, eventType, {...})` takes the caller's `tx`, so
     a notification can never outlive a rolled-back write. Where a query helper
     owns the transaction, give it an `afterWrite(tx, result)` hook (see
     `writeStoreBatch`) instead of opening a second one. One routes read + one
     bulk insert per producer — `lib/db.ts` is `max: 1`.
  2. **Self-scoping on every notification read and write:**
     `recipient_user_id = the session user` AND `account_id = the active brand`.
     An id alone never identifies a row; someone else's simply matches nothing.
     Reading your own needs NO permission — `notify.manage` gates the ROUTING
     config only. Pinned by tests/db/notifications.test.ts.
  3. **Silent by default.** No `notification_routes` rows for an event = it
     notifies nobody, and the actor is always excluded from their own event.
  4. **Archive, never delete.** "Clear" sets `archived_at`; restore reverses it;
     archived rows stay searchable in the Archived tab. Nothing hard-deletes.
  5. **Individual notifications are NOT audited** (they'd mirror `audit_events`
     row for row); only `notify.routes_update` is.
  Vocabulary is `lib/notifications.ts` and everything derives from it —
  `EVENT_TYPES` (the routable catalog; the config tab's rows), the five
  categories (phase 1 produces `system` only), `POLL_MS` (the ONE polling knob),
  `safeHref` (an href is data: in-app paths only, never an open redirect).
  `notifications.dedupe_key` is RESERVED for phase-3 alert upserts — its unique
  index is partial so today's NULLs never collide. See tech-spec §5f.
  - **Phase 2 — comments, mentions, replies (2026-09, migration 0044).**
    Anchors: creative · campaign · budget month · an allow-listed aggregate
    page (`COMMENTABLE_VIEWS` in lib/comments.ts). Invariants, all deliberate:
    (a) **every comment captures the commenter's current view** — the query
    string, read from the LIVE location at post time, so a deep link reproduces
    what they were looking at; (b) a comment notifies ONLY by mention or reply
    — a top-level comment with no mentions reaches nobody, and **mention wins**
    so one comment never produces two rows for one person; (c) mentions are
    stored EXPLICITLY from the picker, never parsed out of body text, and a
    non-member mention is REFUSED, not dropped; (d) threads are FLAT — the
    server re-parents a reply-to-a-reply onto the thread's root; (e) `anchor_id`
    has no FK, so the action re-validates the anchor account-scoped and
    allow-lists `view` pathnames; (f) delete is SOFT (the row renders "Comment
    deleted" so replies keep their place), edit is author-only, admins may
    delete anyone's; (g) notification links go through **`/go/comment/[id]`**,
    which resolves the anchor at CLICK time — creatives and campaigns are
    addressed by name, so a stored link would rot on the next rename.
    `comment.update`/`comment.delete` are audited; creation is not.
    - **Relocated to GLOBAL CHROME (2026-09) — a DOCKED panel, not a modal.**
      ONE surface: the top-bar comment icon TOGGLES a 380px `<aside>` in the
      dashboard layout's content row, beside the page column (`flex-1 min-w-0`).
      The page SQUEEZES and stays fully interactive — no backdrop, no focus
      trap, no scroll lock; clicking the page never closes it. It PERSISTS
      across navigation (shows each page's thread; a quiet "no comments here" on
      anchor-less pages), open state in localStorage. **Below `lg` it falls back
      to the full-width overlay Sheet** — don't dock on a phone. No per-page
      panels or header buttons (removed). Chat order (oldest top, newest bottom,
      composer pinned below, scrolled to the end on open). **Clicking a comment
      that carries a view APPLIES that view to the page beside the panel**, which
      stays open — the panel is a set of saved states, and this is the point of
      capturing the view at all. Reply is the only visible row action; Edit and
      Delete live behind a "…" menu. **Delete = UNDO toast (8s), never a
      confirm**: `restoreComment` is allowed ONLY for whoever performed the
      delete (author, or the admin who removed it), checked against the
      `comment.delete` audit row that `deleteComment` writes INSIDE its own
      transaction — keep that row in-transaction or undo silently breaks.
      **Inline @**: typing "@" at text start or after whitespace opens the picker
      (never mid-word or in an email); mentions stay explicit ids, never parsed
      at submit. Anchors come
      from a client `CommentAnchorProvider` in the dashboard layout: an entity
      page renders `<CommentAnchor type id />` and WINS on its own pathname,
      everything else derives a `view` anchor from the pathname, and a page with
      neither hides the icon. Valid view paths DERIVE from `NAV_ITEMS` (admin
      included, `/notifications` excluded) — never re-list them. `/go/comment`
      lands with `?comment=<id>`, which opens the panel on that comment.

- **Sparse audience snapshots: carry forward, never interpolate (2026-09).**
  `audience_snapshots` holds only the days somebody actually MEASURED an
  audience, so every reader in `lib/audience.ts` follows four rules that are
  deliberate, not gaps to be filled: (1) between measurements the last known
  size carries forward as a STEP — a ramp would invent numbers nobody took;
  (2) before a pair's first snapshot the size is UNKNOWN (`—`), never 0 — an
  unmeasured audience is not an empty one; (3) every displayed size carries its
  age, with ONE neutral threshold (`STALE_AFTER_DAYS = 7`) that says "old", not
  "bad" — v1 passes no judgment on size, and stores no target bands; (4)
  pressure (spend per 1,000 audience) counts ONLY days with a known audience and
  is computed as component sums (Σspend ÷ Σ(size/1000)), so an unknown day can
  never smuggle its spend into the ratio and a zero audience gives `null`, not
  Infinity. A range's early days are only knowable because
  `audienceSnapshotSeries` fetches the latest snapshot BEFORE the range as a
  seed — drop that query and the page silently reads "unknown" for a pair
  measured last month.

- **Every DateRangePicker page resolves its range SERVER-side through
  `resolvePreferredRange` / `defaultDateRange` (or its own concrete equivalent)
  — the picker never invents a display default the query didn't run.** The
  picker derives a DISPLAY default client-side (`from/to ?? fallback ??` last-7),
  so a page that passes RAW optional search params to its queries makes the
  label lie: the condition builders only bind when a value is present, so a
  fresh URL ran LIFETIME while the control said "Last 7 days". That shipped on
  `/store/reconciliation` (aggregate numbers claiming a window they never had)
  and `/store/orders` (every order ever, with the count header, pager and CSV
  all following the wrong set) and was fixed 2026-09-19 by resolving on the
  server and feeding ONE range to both the queries and the picker (`fallback`).
  A saved "lifetime" preference decodes to the concrete floor→today range, so
  the picker then honestly says Lifetime. **A new range-filtered page must
  follow this or its label lies**; cleanup tools are the one sanctioned
  exception — their picker IS the filter state (seeded client-side), not a
  window a query silently widened.

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
  publish-date / **priority** / angles, with draft state + a dirty check + an
  explicit **Save changes** button (not auto-save). Save calls `patchCreative`
  (partial — only changed fields; renaming is uniqueness-checked and the client
  follows the new URL). The old `/library/[name]/edit` page,
  `creative-edit-form.tsx`, and the `updateCreative` action were DELETED — don't
  reintroduce them. Notes stay on their own inline editor (`updateCreativeNotes`
  via NotesPanel); `patchCreative` never touches notes. Angle editing uses
  `angle-multi-select.tsx` (a Popover dropdown), and the publish date uses a
  Calendar popover.
- **Priority ≠ Rate — two DISTINCT concepts, never conflate the names.**
  **Priority** (2026-07) is the team's MANUAL importance judgment on a creative:
  `creatives.priority smallint` NULLABLE, 1..3 (3 = highest), NULL = unrated (a
  real default state — never a numeric 0, never auto-set). Field/validator/label
  are all `priority` (`prioritySchema` in `validators/creative.ts`); it's edited
  inline on the detail header (3 lucide `Star` icons, warn-amber fill) via the
  normal draft/Save flow. Migration 0028 (additive, no index).
  **SUPERSEDED 2026-09 — Priority is now VISIBLE, SORTABLE and FILTERABLE.** The
  old "detail page only, no list/summary/CSV/filter" scope was reversed by the
  user. It now appears on **Library** (a column of filled stars, sortable, a
  3 · 2 · 1 · Unrated filter) and **Ads/Summary** (with the pinned creative-
  identity columns — NEVER inside a per-platform metric group, since priority is
  a per-creative field — sortable, same filter, hideable like its sibling
  identity columns); both CSVs carry it, with unrated as an EMPTY cell. Shared
  vocabulary lives in `lib/priority.ts`; the read-only star display is
  `components/creative/priority-stars.tsx`. **UNRATED SORTS LAST IN BOTH
  DIRECTIONS** (`comparePriority`) — an absence of judgment is not a low one, so
  Postgres' default NULL placement is overridden (`NULLS LAST` in the Library's
  SQL sort, a JS re-sort on Summary where the base order is spend). The Ads
  filter pill uses a FLAG icon, not a star: `Star` already means **Rate** in that
  bar, and these two must never read as one thing. **Rate** is a
  totally different, COMPUTED concept — the ROAS-driven performance chips
  (`rating_rules` / `lib/rating.ts` / Summary "Rate" filter). Rule: **Rate =
  computed performance; Priority = manual judgment.** The word "rating" must
  NEVER name the Priority feature, and "stars" is only the UI metaphor (the icon)
  — it appears nowhere in the schema/code.
- **Stage (2026-09) — the creative's MANUAL funnel declaration. A STANDING
  DECISION.** `creatives.stages text[] NOT NULL DEFAULT '{}'` (migration 0045,
  additive, GIN index — it's filtered by OVERLAP): any 1, 2 or all 3 of
  **Awareness · Activation · Retargeting**. Empty = **unassigned**, a real
  default state.
  - **NEVER auto-derived.** Not from the campaign objective a creative happens
    to run under, not from where it spends. It is the team saying where the
    creative sits, and nothing may infer it for them.
  - **A DIFFERENT AXIS from the campaign Objective and the Budget buckets.** A
    creative declared Retargeting can spend inside an Awareness campaign, and
    that mismatch is INFORMATION, not an error — never "fix" it, never warn on
    it, never reconcile the two.
  - **One vocabulary, `lib/funnel-stages.ts`** (`FUNNEL_STAGES` / `STAGE_SHORT`
    / `stageLabel` / `sortStages` / `compareStages`), derived from
    `BUDGET_OBJECTIVES` minus "Other" and RE-EXPORTED by `lib/audience.ts` —
    hoisted there so the creative and audience sides share one definition.
    Never re-list the stage names (not in SQL either: the Library and Summary
    stage sorts run in JS through `compareStages` rather than encoding the
    funnel order in an ORDER BY).
  - **Sort rule: by the EARLIEST stage in funnel order, UNASSIGNED LAST in both
    directions** ({Awareness, Retargeting} ranks as Awareness). Same shape as
    Priority's unrated-last rule.
  - **Filter semantics: OVERLAP** — a creative matches if ANY selected stage is
    on it; "Unassigned" matches the empty array. Surfaces: the detail header
    (toggle chips in the draft/Save flow), the create form, bulk import (a
    `stage`/`stages` column, full names or TOF/MOF/BOF), Library + Ads columns
    (compact TOF/MOF/BOF chips, sortable, filterable, in both CSVs), and MCP
    (`list_creatives`/`get_creative` output + a `stages` filter).
  - **Naming discipline, like Priority ≠ Rate:** **"Stage" is the CREATIVE's
    field; "Objective" stays campaigns-only; "bucket" is Budget's.** Don't let
    the three words drift into each other.
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
- **Multi-tenancy = row-level `account_id`, scoped in the query/action layer;
  brand membership IS enforced at tenant resolution (2026-07).** The app manages
  2–5 brands from one DB; the active brand is the `ccms_account` cookie, resolved
  per request by the cache()-deduped `getActiveAccountId()` / `listAccounts()` /
  `getActiveAccount()` in `lib/tenant.ts` (mirrors `auth()`). **Brand membership
  gates which brands a user may see** (permissions say WHAT, membership says
  WHERE): `users.all_accounts = true` (default/legacy) → member of EVERY brand,
  **including brands created later**; `false` → only the brands in the
  `user_accounts` join table. **Admins are always effectively all-accounts**
  (code bypass, like the permission bypass). The pure resolution logic lives in
  `lib/account-access.ts` (`allowedAccountIds` + `resolveActiveAccountId`), fed
  live data by `lib/tenant.ts`: `listAccounts()` returns only ALLOWED brands (so
  the `AccountSwitcher`, the **Brands** tab, and `setActiveAccount`'s validation
  all enforce membership), and `getActiveAccountId()` returns the cookie's brand
  only when it's ALLOWED — a forged/stale cookie deterministically falls back to
  the user's first allowed brand (NOT an error), and **zero allowed brands throws
  `NO_BRAND_ACCESS`**, which the dashboard layout pre-empts with the full-page
  "No brand access" screen BEFORE any tenant query runs. `listAllAccounts()` is
  the UNFILTERED list (the Team admin, whose `users.manage` editor may grant any
  brand; the slug-uniqueness / grant-validation checks). Membership is managed on
  the **Team** page (`updateUserBrands` / invite in `app/actions/user.ts`, audited
  `user.brands_update`); `createAccount` auto-grants a restricted creator
  membership to the new brand in-transaction. `setActiveAccount`/`createAccount`/
  `renameAccount`/`setStatusWindow` (the last two now gated to an allowed brand)
  live in `app/actions/account.ts`. The upload validate→commit flow needs no
  membership change — commit uses the account pinned on the validation session at
  validate time (allowed then). Migration **0027** (additive: `all_accounts` NOT
  NULL DEFAULT true + `user_accounts` — existing users keep today's every-brand
  behavior). Every tenant table carries `account_id`
  (FK → `accounts`, DEFAULT the Urjwan id `00000000-0000-0000-0000-000000000001`):
  products, creatives, angles, performance_records, upload_batches,
  upload_validation_sessions, summary_views, platform_field_mappings,
  audit_events, rating_rules (PK = account_id), platform_rating_rules
  (PK = (account_id, platform)). `creative_angles` has NO `account_id` — it's
  scoped transitively via its creative, so angle rename/delete **cascades must be
  bounded by a `creatives WHERE account_id` subquery** (else a shared angle string
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
  creative (angles cascade). The confirm dialog
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
  landed in the pipeline but never showed in the CSV-mapping surface. Fixed
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
    **By-angle** (`angle-rollup-table.tsx`), **Video** (`video-diagnostics-table.tsx`),
    the **campaign row-data** table (`campaign-records-table.tsx`), and the
    creative-detail **campaigns/platform** table (`creative-campaigns-table.tsx`,
    local sort + a By campaign / By platform mode toggle; totals derived from
    component sums so they match across modes; row-click → campaign detail), and
    the **Library** table (`creative-table.tsx`, migrated 2026-09 — see below).
    The Columns dropdown lives in each consumer's toolbar and drives `hidden`.
    (The old hand-rolled `creative-platform-table.tsx` — expandable per-platform
    rows — was replaced by this and DELETED.)
  - **The LIBRARY table (2026-09) — DataTable, with three things worth keeping.**
    (1) **Sorting stays SERVER-side.** No column carries a `sortValue`, so
    DataTable never re-sorts locally: the query layer owns the derived-status
    order, "unrated last" and "earliest stage, unassigned last", and the table
    only reflects the URL's `?sort=`. Its header keeps the Library's
    THREE-state cycle (desc → asc → back to the page default) by interpreting
    `onSort` itself — DataTable proposes a direction, the consumer decides what
    the URL says. (2) **A Columns menu** on the shared hidden-key pattern
    (`usePersistentHidden`, per browser), with notes / source link / thumbnail /
    created-by / created-at hidden on a first visit. A key absent from the
    stored set is VISIBLE, so a column added later still shows up. (3) **Cells
    that cannot grow the row.** `AngleChips` renders at most two width-capped,
    truncated chips plus a "+N" whose tooltip names the rest, and `StageChips`
    takes `nowrap`; measured against the built CSS, the Angles cell is 271px
    and the row 43px whether a creative has zero angles or eight long ones.
    **The CSV is deliberately NOT the visible column set** — it exports the
    whole record regardless of the menu (shape pinned by
    `creative-csv.test.ts`).
  - **THE GROUPED-HEADER EXCEPTION: the Summary table** (`summary-table.tsx`) is
    NOT on DataTable and shouldn't be forced onto it — its columns are
    per-platform GROUPS (a grouped header row), not flat columns, so it
    reorders/hides at the group level. It already shares the same visual language
    (borders, sort arrows, resize handle) — DataTable's border style was derived
    from it. Leave its structure; only keep the look in sync.
    **It gained a SIBLING in 2026-09: Reconciliation's Platforms table**
    (`ByPlatformTable` in `reconciliation-view.tsx`), where each platform is a
    group of four columns (Store · Claim · Δ · Δ%) — same reason, same visual
    language, deliberately denser (`text-xs`, `px-1.5 py-1.5`, compacted counts)
    so four platforms fit a 1366px desktop without horizontal scroll. These two
    are the WHOLE list: a grouped header is the only licence to leave DataTable,
    and a flat table that wants one should be re-thought, not hand-rolled.
  - **Chart metric pick → `components/charts/metric-picker.tsx` (`MetricPicker`)**
    — one segmented control (wraps when many options). Replaced the old mix of
    native `<select>`, shadcn `<Select>`, and ad-hoc pill/segment groups. On it:
    campaign creative chart, trends type×platform, metric-over-time,
    creative-perf-line.
  - **Chart series legend → `components/charts/series-legend.tsx`
    (`SeriesLegend`)** — one toggle-chip legend for show/hide series (funnel rate
    lines, campaign creative lines). It renders BELOW the plot via `ChartShell`'s
    `legend` slot (in both the inline card and the fullscreen overlay), never in
    the header zone; a "Show all" reset chip appears (via `onShowAll`) while any
    series is hidden.
  - **Chart header → `ChartHeader` in `chart-shell.tsx`** — the one canonical
    line-chart header row: Title (`text-sm font-medium text-ink`, sentence case)
    → MetricPicker/segmented control → right-aligned cluster (Group → Smooth →
    Expand; the Fit toggle stays a conditional in-plot overlay). Never hand-roll
    a chart header or put loose text/legends in it — every ChartShell chart uses
    ChartHeader so titles read identically and the plot's top edge never varies.

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
    (`NAV_ITEMS`/`isActive`/`navSections`) drives BOTH the desktop `Sidebar` and
    the mobile `MobileNav` (hamburger + Sheet, `lg:hidden`, in the TopBar). Items
    carry a `group` (`ads`|`budget`|`store`|`admin`); `navSections()` buckets the
    visible items into the four labeled `NAV_SECTIONS` so both navs render the same
    eyebrow-labelled sections — restructure grouping there, never per-surface.
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
  (an `as const` catalog of 6 groups / 24 keys) → the `Permission` union +
  `ALL_PERMISSIONS` are derived from it, so any new capability is added in ONE
  place and every surface (checks, the Team UI, nav) follows.
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
  - **The unified Team page** (`/admin/users`, `users.manage`) is the ONE place
    to add people and manage access — invite form on top, then one
    `UserAccessCard` per member (`components/user/user-access-card.tsx`) that owns
    role+permissions AND password reset. The card: preset selector (Admin/Editor/
    Viewer/Custom) + group checkbox grids + a dirty Save/Discard bar +
    `AdminSetPasswordButton`; admin cards render all-checked+disabled; you can't
    edit your OWN access. `updateUserAccess` in `app/actions/user.ts` enforces the
    guardrails (no self-edit, can't demote the last admin) and audits
    `user.permissions_update` with before/after `{role, permissions}`. The invite
    flow accepts `viewer` too. (`/admin/access` is a redirect stub → `/admin/users`;
    the old per-row `UserRoleSelect` + `updateUserRole` were removed — the card's
    preset selector supersedes them.)

- **SYSTEM-REQUIRED store fields (2026-09) — a THIRD tier.** `utm_source` and
  `channel` (`SYSTEM_REQUIRED_KEYS` in `store/fields.ts`) exist in every account,
  can't be deleted, and can't have `required` switched off — enforced SERVER-side
  in `app/actions/store-field.ts`, not just hidden in the UI. They are NOT core:
  core stays exactly the three identity columns, and these two live in
  `attributes` jsonb like any other custom field. Label + accepted headers stay
  editable. **"Required" means the COLUMN must be present in every upload
  (S010) — blank CELLS are fine**: plenty of orders genuinely have no UTM, so the
  pipeline COUNTS blanks per field (`blankCounts`) and the upload review states
  it in neutral prose ("1,240 rows · 312 without a UTM source"), with no warning
  styling. An ordinary required custom field still errors on a blank (S042) —
  the two tiers differ on purpose. `createAccount` seeds all five rows (3 core +
  these 2); migration 0046 promotes an existing field KEEPING its label and
  headers, or seeds it where missing.
- **Store → Reconciliation is COUNTS ONLY, by explicit user decision (2026-08).**
  `/store/reconciliation` compares store ORDER COUNTS vs platform-claimed
  CONVERSION counts per day. **Δ = claimed − store as of 2026-09-19 — the
  INFLATION framing, a user decision that SUPERSEDES the original
  `store − claimed`: POSITIVE Δ means platforms claim MORE than the store
  recorded** (actual 80, claimed 100 → Δ +20, Δ% +25%). Δ% divides by the STORE
  side (what actually happened is the base) and is still NULL when store = 0.
  The math lives ONLY in `reconDelta`/`reconDeltaPct` (`lib/reconciliation.ts`)
  and `channelDeltas` (`store/channels.ts`) — never re-derive a delta in a
  component, and do NOT "fix" the sign back. There is deliberately **no
  revenue comparison anywhere** on the page (no exchange rate, no revenue delta,
  no platform revenue): store revenue (SAR) and spend (USD) exist only as
  optional context columns, hidden by default, and are NEVER diffed against each
  other. Do **not** add a revenue/ROAS comparison without asking — it was
  explicitly scoped out. Δ% is warn-tinted by |MAGNITUDE| (over- and under-claim
  are both discrepancies — not good/bad green/red), and "—" when store = 0; the
  tone rule is sign-independent, so the 2026-09-19 flip left it untouched, as it
  left `reconMatchRate` (claimed ÷ store).
  **Attribution is EXPLICIT-mapping only** (house rule), on TWO axes since
  2026-09 (migration 0046) and nothing else is configurable:
  (1) **utm_source → platform** via `store_source_mappings`; the "which field is
  the source?" PICKER IS RETIRED — the source is always `utm_source`, pinned in
  code as `STORE_SOURCE_FIELD_KEY`, with `accounts.store_source_field_key`
  backfilled to it and NO LONGER READ (a kept-dead column, like
  `store_order_fields.show_in_table`).
  (2) **channel → Website | Application** via `store_channel_mappings` (unique
  `(account_id, raw_value)`; app-side enum, no DB enum). Unmapped/blank on either
  axis stays its own visible bucket — Unattributed for sources, Unmapped for
  channels — and is NEVER folded into a neighbour.
  **The page has TWO views (toggle FIRST in the controls row): Channels
  (DEFAULT) · Platforms.** The old **Overview** view was MERGED AWAY in 2026-09:
  it showed store orders vs claimed with revenue/spend for context, which is a
  strict SUBSET of Channels (Store total · Claimed + the two context columns), so
  its table, columns-menu branch and CSV variant were deleted rather than
  maintained. Mode is client state defaulting to `"channel"` and has never been a
  URL param, so no saved link can ask for the removed view. Channels is a
  **DataTable** (flat columns → the canonical home; sortable throughout, day
  desc by default, evenly-sized columns, pinned totals row): Store total ·
  Website · Application · Unmapped (column only when > 0) · Claimed (all
  platforms) · **Δ incl. app** = claimed − (Website + Application) · **Δ incl.
  app %** · **Δ excl. app** = claimed − Website · **Δ excl. app %** — the number
  and its share are SEPARATE sortable columns, each Δ% warn-tinted by
  |magnitude| and sorted by SIGNED value with "—" (store 0) last in both
  directions. Revenue (SAR) and Spend (USD) are the hidden-by-default context
  columns that came over from Overview; the CSV exports exactly the visible
  columns in the on-screen sort. Rationale, stated on the page: platform pixels
  largely see WEBSITE purchases, so Δ excl. app is the honest attribution gap and
  Application explains the rest. Platforms leads with Day · Store total ·
  Unattributed · Unattributed % (= unattributed ÷ store total,
  `unattributedShare`, NULL → "—" when the store total is 0) and then one
  four-column group per platform. **Every totals row on this page is computed
  from the range SUMS (`sumChannelDays`, `sumPlatformDays`), never by averaging
  the per-day figures** — test-pinned, because a mean of daily ratios is a
  different and wrong number. **Invariant (test-pinned): Website + Application +
  Unmapped = Store total every day** — buckets reconcile by construction via the
  unique mapping, exactly like platforms. Never
  auto-match source values. Buckets reconcile by construction (unique mapping →
  no fan-out → per-platform + unattributed = overview count). Pure Δ/Δ%/lag math
  lives in `lib/reconciliation.ts`; queries in `db/queries/reconciliation.ts`
  reuse `sumConversions`/`sumSpend` from `lib/metrics` and the per-platform
  freshness scan for the "still attributing" lag hint. Migration 0031 (additive).

- **Exclusion provenance (2026-09): the `excluded_from_aggregates` flag has TWO
  writers and they never overwrite each other.** `excluded_source` says who
  flipped it — `'manual'` (per-record action) or `'rule'`
  (`excluded_rule_id` → `exclusion_rules`, the account-global rule engine in
  `lib/exclusion-rules.ts` + `db/queries/exclusion-rules.ts`; "materialized
  with provenance" — aggregate queries never special-case rules). Invariants:
  applying a rule SKIPS already-excluded rows (manual, or another rule's — a
  row keeps its FIRST rule, created_at order); un-applying touches ONLY rows
  with that rule's id AND `excluded_source='rule'`, and the removal transaction
  then RE-SWEEPS the remaining active rules, so a row covered by two rules stays
  excluded (re-stamped by the survivor) instead of silently returning to totals;
  **manual un-exclude REFUSES rule-excluded rows** (the action returns
  "Excluded by rule «…»" and the row's Re-include button is disabled) — restore
  them by deactivating the rule in Configuration → Exclusions (still there). Rule mutations
  reuse `record.exclude` but are always preview-then-confirm with an
  acknowledgement checkbox, and audited (`exclusion.rule_*`) with the count the
  engine ACTUALLY flipped. New/upserted uploads are stamped against ACTIVE
  rules inside the commit transaction; `deleteCreative`/`deleteCampaign` delete
  rules targeting the entity in-transaction (the FK has no cascade on purpose).
  The Excluded TOGGLE is per-user (`users.include_excluded`, resolution URL →
  pref → hidden); the RULES are account-global — pausing one changes everyone's
  numbers.

- **Campaign objectives merged 2026-09 (migration 0034):** the vocabulary is
  exactly **Sales, Prospecting, Retargeting, Awareness, Activation, Special
  Case** (`CAMPAIGN_OBJECTIVES` in lib/campaign.ts — everything derives from
  it; "Special Case" was added new, later in 2026-09). "Reach&Freq", "Traffic"
  and "Video Views" were RETIRED and every existing campaign carrying one was
  renamed to "Awareness" (saved campaign-view objective filters were swept +
  deduped too). Never reintroduce the removed values. **Any future objective
  rename/merge must ALSO sweep `budget_allocations.objective` (and saved
  views)** — this was true until 2026-09. **Superseded: `budget_allocations`
  now stores BUDGET BUCKETS, not campaign objectives** (see the Budget bullet's
  objective-bucket entry). A campaign-objective rename touches
  `toBudgetObjective` in lib/budget.ts and nothing else in Budget; saved views
  still need the sweep.

- **Budget module (2026-09, v2) — raw actuals BY DECISION.** Its own sidebar
  section of 5 pages (`/budget` Overview · `/budget/plan` · `/budget/tracker` ·
  `/budget/pacing` · `/budget/audience`);
  Overview and Plan share `?month=` (nav links preserve it), Pacing takes a date
  range. The old **Daily** and **History** pages MERGED into Pacing and are
  permanent redirects to it (History asks for the last 12 months grouped by
  month) — don't reintroduce them. Monthly spend
  plan (USD, platform → objective) vs actual and ONE monthly revenue target
  (SAR) vs store actuals, paced along a **plan curve** (the day-weight curve;
  user-facing text says "plan curve" — only non-1 day
  weights stored in `budget_day_weights`; no-overrides ≡ v1 linear, unit-pinned;
  ONE curve for spend AND revenue; projection = actual ÷ elapsed curve
  fraction) plus a **reserve** (`budget_targets.reserve_spend_usd`, part of the
  total and carved out of it, deliberately OUTSIDE the curve; "used" = the
  month's unplanned actual spend).
  Standing decisions: actual spend deliberately applies **NO exclusion
  filtering** anywhere in Budget (raw `performance_records` totals, per-day
  included — budget totals may differ from dashboards; never "fix" this);
  revenue = store FACTS as a monthly total only (no breakdown; claimed-vs-real
  lives on Reconciliation); the USD↔SAR toggle is display-only (localStorage)
  but ROAS is ALWAYS computed through the per-brand `accounts.usd_to_sar_rate`
  (default 3.77). The spend table's Unplanned bucket must reconcile its actual
  total to the raw month total exactly (harness-pinned). A period past its
  side's horizon renders as an em-dash (unknown ≠ 0). Pacing VERDICTS (Overview's
  tiles and its allocation check) are current-month-only; the **Pacing page** is
  a date range. Deviations everywhere are warn-tinted by |magnitude| — never
  green/red. Permission
  `budget.manage`; audit `budget.update`. Migrations 0035 + 0036 (additive).
  - **The Plan tab is planning-only (2026-09).** `/budget/plan` carries intent
    and nothing else — Platform/objective · Planned · % share. The Actual,
    Pacing, Variance and Variance % columns and the "unplanned" ghost rows were
    REMOVED; plan-vs-actual lives on Overview and the Pacing page.
    `getBudgetMonth()` still returns `actualSpendByCombo` for its other
    callers — don't reshape it; the Plan page just ignores it.
  - **The Plan editor is a TOP-DOWN CASCADE (2026-09): targets → platform
    shares → objective shares → day curve.** Percentages are the PRIMARY input;
    amounts are derived cents-exactly from them (amounts stay editable and
    back-compute their share against a held parent). `budget_allocations
    .planned_spend` (USD) is still the only storage — SAVE stores the derived
    amounts, EDIT reconstructs the shares from them (total = Σ allocations +
    reserve) at full precision, so a round-trip is exact. Pure helpers in
    `lib/budget.ts`: `allocatableFromTotal`, `reserveShare`/`reserveFromShare`,
    `amountsFromShares`, `shareFromAmount`, `sharesComplete`,
    `distributeShareEvenly`, `normalizeShares`, `moveMoney` — plus the cents-exact
    `splitByWeights`/`distributeRemainder` they build on. Never re-derive this
    math per component.
  - **The RESERVE is part of the TOTAL, not on top of it (2026-09 framing).**
    `allocatable = total − reserve`; the reserve is money carved out and not yet
    allocated. Storage (`budget_targets.reserve_spend_usd`) is UNCHANGED, and it
    still sits OUTSIDE the plan curve — the curve paces the ALLOCATED plan
    only. Overview's "used = the month's unplanned actual spend" reading still
    holds: spend outside the plan draws the reserve down.
  - **Save is BLOCKED below 100% (user decision).** Platform shares must reach
    exactly 100% of the allocatable and every planned platform's objective
    shares must reach exactly 100%; the banner names each gap and "Distribute
    remaining evenly" fixes it in one click. Money not yet committed belongs in
    the RESERVE, never in a gap. Rounding must never block — `SHARE_EPSILON`
    tolerates float dust only, and derived amounts are cents-exact.
  - **Two mid-month operations, KEEP THEM DISTINCT.** Changing the total (or
    reserve) RESCALES everything through the current shares. "Move money"
    moves money: the source (the reserve or a platform) falls by the amount —
    or, for new money, the total grows by it — one platform's dollars rise by
    it, and every other platform's dollars are untouched (only their displayed shares move). Don't
    collapse them into one control — the difference is the whole point.
  - **Plan revisions (`budget_plan_revisions`, migration 0040, additive).**
    Every write that changes a plan — `saveBudgetMonth`, `copyBudgetFromMonth`,
    `restorePlanRevision` — appends a jsonb snapshot of the plan AS IT STANDS
    AFTERWARDS, **inside the same transaction as the write**. Any new plan-write
    path must do the same, or the history silently gains a hole. A restore
    re-validates its snapshot through `planSchema` FIRST (a snapshot predating a
    vocabulary change fails loudly rather than half-applying) and is itself
    recorded as a revision, so restoring never loses the state it replaced.
    `copyBudgetFromLastMonth` was renamed `copyBudgetFromMonth({month, from})` —
    copy from ANY planned month, options from `plannedMonths()`.
  - **Budget has its OWN objective axis (2026-09) — `BUDGET_OBJECTIVES` in
    lib/budget.ts: Awareness · Activation · Retargeting · Other.**
    `toBudgetObjective(campaignObjective)` keeps the three mains and sweeps
    everything else (Sales, Prospecting, Special Case, anything added later)
    into **Other**. Campaign objectives OUTSIDE Budget are untouched. The bucket
    is applied at EVERY budget layer — `planSchema`, the Plan editor's pickers,
    actual-spend grouping (folded inside `db/queries/budget.ts`, so no consumer
    can forget), and revision restore, which folds legacy snapshots through
    `mergeAllocationsToBuckets` and SUMS rows that collapse together (an old
    Sales + Prospecting snapshot restores as one Other row instead of failing
    or colliding on the unique index). Migration **0041** (hand-written, DATA
    only) did the same fold to the stored rows — it stages the totals in a temp
    table, deletes, then re-inserts, because a data-modifying CTE doesn't order
    its DELETE against the outer INSERT and the unique index would abort.
    **Never re-list the buckets** — derive from `BUDGET_OBJECTIVES`.
  - **The allocation check lives on OVERVIEW (2026-09), grouped by bucket.**
    Planned vs actual per bucket × platform with unplanned rows; the
    reconcile-to-raw-month-total invariant is enforced HERE and pinned by
    tests/db/budget.test.ts.
  - **Pacing is a DATE RANGE, not a month (2026-09).** URL-backed
    `from`/`to`/`groupBy`/`platforms`; group by Day / Week / Month (weeks are
    Sunday-start calendar weeks CLIPPED to the range); a platform multi-select
    that scopes BOTH actual and plan; metric Spend / Revenue / **ROAS**
    (on-plan ROAS = target-to-date ÷ (plan-to-date × rate)); an objective
    toggle that gives one series and one table block per bucket. **Revenue has
    no platform attribution anywhere in Budget** (that's Reconciliation), so a
    platform filter LOCKS the metric to Spend and the UI says why instead of
    hiding it. Plans are per MONTH, so a range spreads each month's plan across
    its days by the plan curve and stitches them (`stitchPlanByDay`);
    `budgetPlansForMonths(months)` is THREE queries with an `inArray`, never one
    per month, and `budgetPacingSeries(from, to)` stays two scans (`max: 1`).
    The objective on a spend row is the campaign's CURRENT objective seen
    through the bucket lens, so reclassifying a campaign restates budget
    history. `budgetHistory()` was deleted — month grouping replaced it.
  - **Tracker (`/budget/tracker`, 2026-09) — the ZERO-CONFIGURATION daily
    pace board.** One question, answered in bars: who's ahead, who's behind,
    by how much. The month and the currency are its ONLY controls and that
    absence is the feature — **Pacing is the analysis tool** (ranges, grouping,
    platform slicing) and **Overview is the month's verdict, untouched by user
    decision**. Nothing here is new data: it reads the SAME `getBudgetMonth()`
    payload and derives everything through `buildTrackerRows` (pure,
    unit-tested, in lib/budget.ts), which composes the module's existing
    conventions — `curveExpected` for plan-to-date, `pacingDeviation` /
    `pacingTone` for the magnitude-based verdict, `projectedMonthEnd` for the
    "on this pace" line. **Never re-derive pacing in the page.**
    - **The bar says three things at once:** the TRACK is the row's full-month
      plan, the FILL is actual month-to-date, and the TICK is where the plan
      curve says today should be. Pure CSS, tokens only (surface-2 / brand /
      ink-3), warn-tinted by |deviation| through the shared threshold. The tick
      stands 4px PROUD of the track — against the fill it is nearly invisible
      (1.06:1 on Midnight), and it is the whole point of the bar. Every bar
      carries an aria-label that says the numbers in words.
    - **A row with no plan gets NO bar** — there is no track to draw against.
      Unplanned spend is an amount-only line per platform ("draws down the
      reserve"), which is the same reserve framing Overview uses.
    - Past month → the tick sits at 100% and the projection is replaced by
      "final for <month>"; future month → tick at 0, no verdict at all (nothing
      is expected yet, which must never read as 100% behind). Both fall out of
      `elapsedDaysInMonth`, not a special case.
  - **Funnel audience (`/budget/audience`, 2026-09, migration 0042 additive).**
    Hand-measured audience sizes per funnel stage × platform, versus spend.
    **Stages DERIVE from `BUDGET_OBJECTIVES` minus "Other"** (`FUNNEL_STAGES` in
    `lib/audience.ts`) — Awareness/TOF · Activation/MOF · Retargeting/BOF; never
    re-list them. Permission `audience.manage` (NOT in the editor preset — the
    measuring chore and planning authority are different jobs); audited
    `audience.record`/`update`/`delete`. Spend is the module's RAW basis and
    comes from `budgetPacingSeries` — never add a second spend scan. USD only
    (no currency toggle: pressure is a ratio). See the Learned entry for the
    sparse-snapshot semantics, and tech-spec §5e.

- **2026-09: "tag" → "angle" at ALL layers — DB, URL params, code, UI, MCP.**
  The creative-labeling concept is called an **angle** now. Tables `tags` /
  `creative_tags` became `angles` / `creative_angles` (column `tag` → `angle`),
  the permission key `catalog.tags` became `catalog.angles`, the `?tags=` filter
  param became `?angles=`, `/trends/by-tag` became `/trends/by-angle` (old route
  kept as a redirect stub), and the MCP `tags` field/filter became `angles` (a
  BREAKING change for connected clients — no alias, called out in the tool
  descriptions and the connect panel). Migration **0037** is a hand-written
  RENAME (never regenerate it — `drizzle-kit generate` emits DROP+CREATE and
  would destroy every assignment) that also sweeps the stored strings in
  `users.permissions` and `summary_views.query`. **Never reintroduce "tag" for
  this concept.** Two things deliberately keep the old word: historical
  `audit_events` rows keep their `tag.*` action strings (append-only; rendered
  with their original wording via `LEGACY_AUDIT_LABELS` in `lib/audit.ts`), and
  the campaign-name **platform tag** (`PLATFORM_TAG` in `lib/campaign.ts`, the
  ` (IG)`/` (FB)` suffix) is a different concept that keeps its name. The
  account-scoped-cascade invariant carries over verbatim: `creative_angles` has
  no `account_id`, so angle rename/delete cascades MUST be bounded by a
  `creatives WHERE account_id` subquery.

- **2026-09 IA pass — page names, routes, and where settings live.** The
  sidebar's Ads group reads **Dashboard · Library · Ads · Funnel · Campaigns ·
  Canvas · Trends · Compare · Upload ads** (Canvas was added later in 2026-09;
  the rest of the order is unchanged). Three renames, and only
  ONE of them moved a URL:
  - **Library** — the Creatives page; the route really moved, `/creatives` →
    **`/library`** (`/creatives` and `/creatives/[name]` stay as PERMANENT
    redirects that preserve query params, so shared filter links and the
    detail pager's list-context still work).
  - **Ads** — `/summary` KEPT its URL (saved views hang off it); only its
    labels changed. The sidebar SECTION is also called "Ads" — that repetition
    is deliberate and user-approved.
  - **Upload ads** — `/uploads` KEPT its URL; labels only, symmetric with
    Store's "Upload orders".
  **Settings now live with what they configure**, as in-page tab rows built on
  the shared `components/layout/page-tabs.tsx` (which renders nothing when only
  one tab survives permission filtering): Library = *Creatives | Products |
  Angles*, `/uploads` = *History | CSV mapping* (the old **Platforms** tab is
  MERGED in as the mapping surface's readiness header), `/store/uploads` =
  *History | Order fields* (fields + the Reconciliation source mapping).
  Configuration (`/admin/catalog`) keeps exactly **Rate rules | Status | Brands
  | Exclusions**. Permissions are UNCHANGED — the same key gates each tab
  (`catalog.products`, `catalog.angles`, `config.mappings`, `config.store`).
  Every retired `?tab=` value redirects to its new home (including `tab=tags`,
  for bookmarks predating the tag→angle rename), and `/admin/products` /
  `/admin/platforms` re-point. Two things deliberately did NOT follow the
  Library rename: saved views' internal `page` key stays `"creatives"`
  (invisible plumbing — changing it would orphan every saved Library view), and
  the MCP tools stay `list_creatives`/`get_creative` (the ENTITY is still a
  creative). Code identifiers for the Ads page (`SummaryTable`,
  `listCreativeSummary`, `validators/summary`) likewise keep the "summary"
  name — the route did not move.

- **Campaign OBJECTIVE edits must re-derive exclusion stamps (2026-09).** The
  rules engine only ever ADDS stamps (`applyRule` skips already-excluded rows),
  so nothing re-evaluated existing ones when a campaign was re-classified.
  `updateCampaign` now runs, in ONE transaction with the write and only when the
  objective actually changed: `releaseStaleObjectiveStamps` (drops THIS
  campaign's stamps from `campaign_objective` rules that no longer match,
  guarded by `excluded_source='rule'` so manual exclusions survive) then
  `resweepActiveRules`. Any future edit path that can change a campaign's
  objective must do the same, or the rules page and every aggregate silently
  disagree with the rules.

- **Store upsert PATCHES `attributes`; it does not replace them (2026-09).** A
  store export is often a partial view of the order, so the pipeline reports
  which configured custom fields actually had a mapped COLUMN in the file and
  `writeStoreBatch` uses that: column PRESENT + value → set the key; column
  PRESENT + blank → REMOVE the key (explicit clears still work); column ABSENT →
  leave the stored value untouched. Never go back to writing the whole object on
  an update — that wiped every custom value whose column wasn't in that file.
  Note the drizzle trap: an array inside a raw `sql` template expands to
  `($1,$2)` (a row expression), so the cleared-keys list is bound as ONE
  `text[]` literal.

- **GOOGLE (2026-09) — the STANDARD pipeline with a REDUCED metric set.**
  Google is a platform in `ALL_PLATFORMS` (lib/palette; `platformEnum` derives
  from it) and needed no migration for the vocabulary — `platform` is a
  varchar, not a PG enum. **Its only special behaviour is its DATA SHAPE.**
  Everything about identity, uploads and creatives is the ordinary path.
  - **SUPERSEDED (2026-09-20, a user decision): the system-creative design is
    GONE.** The original build stamped every google row with one app-owned
    "Google Ads" creative on a "Collection" product, ensured at validate and
    commit time, badged in the Library and protected from rename/delete. All of
    it is removed — `ensureGoogleCreative`, `db/queries/google.ts`,
    `lib/google.ts`, the `SystemBadge`, the action guards, the MCP `isSystem`
    field and the `synthesizeAbsent` pipeline hook (google was its only user).
    **`creatives.is_system` is now a DEAD COLUMN**, kept unread like
    `creatives.status` and `store_order_fields.show_in_table`; a later cleanup
    migration can drop the set together. Don't reintroduce reads. No prod row
    ever carried it (the count was 0), so no data path was needed.
  - **Uploads are standard.** A google export carries a **Creative** column and
    an **Ad group** column, prepared by the team before upload, and the
    ordinary errors ARE the interface: a missing column is **E010**, a blank
    identity cell **E042**/E021, an unregistered creative **E020**. Nothing is
    synthesized and there is no google-specific copy anywhere. The team creates
    and owns whatever creative(s) those rows name — one or many, their choice.
    Headers are assumed (`Day`/`Campaign`/`Ad group`/`Creative`/`Cost`/…) and
    admins re-map them per account like every other platform. Google takes NO
    `PLATFORM_TAG` (that stays IG/FB-only), and `platform_rating_rules` needs
    nothing seeded — rows are created on demand, so google uses
    `DEFAULT_RATING_RULES` until someone overrides them.
  - **The unavailable set is DECLARED ONCE**, in `FIELD_META.unavailableOn`
    (`csv/platforms/types.ts`): google reports no `landing_page_views`, no
    `add_to_cart`/`add_payment`, and no `video_views_*`. THREE behaviours
    derive from that one declaration — E010 skips those columns for google; the
    pipeline stores **NULL, not 0**; and `lib/metrics.ts` builds its ratio
    guard from it. Never hand-list the fields or the platform at a consumer.
    (The mapping admin greys those rows out and `addHeaderMapping` refuses
    them, so nobody maps a header the pipeline would ignore.)
  - **NULL ≠ 0 is the whole point.** "The platform never measured this" is not
    "the platform measured zero", and only NULL keeps a row out of BOTH sides
    of a blended rate. The v1.2 blank-CELL-reads-as-0 decision is untouched —
    that is the present-column path; this is the absent-COLUMN path.
  - **The ratio-poisoning guard (lib/metrics.ts).** SUM skips NULLs, so an
    unguarded blended ratio takes its numerator from every platform and its
    denominator from only the ones that measure it. `purchaseRate` is the sharp
    case: with google's conversions in the numerator and only instagram's
    add-payments in the denominator, a real 25% reads as 250%. So any fragment
    touching an unreported field **excludes those platforms from BOTH sides**
    (`voc`, `cvr`, `atcRate`, `apRate`, `purchaseRate`, `hookRate`, `holdRate`,
    `completeRate`), while the ratios google fully supports (CTR, CPM, CPC,
    CPA, ROAS, AOV) and every plain SUM include it normally. A google-SCOPED
    block renders those rates as "—" (both sides empty), which is correct.
    Pinned by `lib/metrics.test.ts` (shape) and `tests/db/google.test.ts` (the
    number, against the real query, with the inflated value asserted NOT to
    appear).
  - **Where google's DATA belongs — `PLATFORMS_WITH_CREATIVES`** (lib/palette =
    `ALL_PLATFORMS` minus google). The surfaces that compare platforms on
    metrics google doesn't report scope their platform set to it: **Ads**
    (`/summary` — no Google column group), **Compare**, **Trends by-angle /
    by-type / Video / Launches**. This is a PLATFORM rule, not a creative one:
    a creative whose only spend is google's still appears on those surfaces,
    as an all-dash row, exactly like a creative that never ran there.
    **Brand/campaign granularity keeps google:** Dashboard, Trends over-time,
    Campaigns, Budget, Reconciliation. **Library shows everything**, google
    totals included.
  - **The FUNNEL surfaces exclude google WHOLESALE (a user decision).** Not
    just from the rates but from the rows: `/funnel`'s `whereFor` and the
    dashboard funnel-rates card both scope to `PLATFORMS_WITH_CREATIVES`, so
    google's purchases can't sit in the conversions column while its ATC column
    is empty — **all-or-nothing, so the page tells ONE story**. `/funnel` says
    so in one quiet line; the dashboard card in a title tooltip. The card's
    VOC/CvR were already google-free through the lib/metrics guard, so its
    CPM/CTR come from `Kpis.funnelCpm`/`funnelCtr` (two extra FILTER aggregates
    on the query that already runs — NOT a new round-trip) and
    `dailyFunnelRates` shares the scope, so the sparklines match the numbers
    above them.
  - **JS-side rates obey the same rules.** `lib/funnel-totals.ts` is the JS
    mirror of the SQL guard and the ONE implementation: weighted via component
    sums, and a row that didn't report a side joins NEITHER side of that ratio,
    so a missing step renders "—" — never 0%, NaN% or ∞%. It backs `/funnel`'s
    pinned totals row and the creative-detail campaigns/platform table. For
    that to work the mid-funnel sums stay **NULLABLE all the way to the UI**
    (`CampaignFunnelRow`, `PlatformMixRow`) — coercing NULL→0 in a query mapper
    is what made a google-only page read "0.0%" instead of "—". The chart
    aggregators (`metric-over-time`, `creative-perf-line`,
    `campaign-creative-chart`) were already safe: they skip a point unless BOTH
    its value and its weight are numbers, which is the same guard by
    construction.
  **MCP inherits all of it** — `get_summary`/`get_funnel` reuse the guarded
  queries, and the shared CONVENTIONS string states the reduced-metric rule.
  See tech-spec §5g.

- **CANVAS (`/canvas`, 2026-09, phases C1 + C1.5) — the campaign↔creative
  graph. READ-ONLY FACTS.** Ads section, between Campaigns and Trends. An edge exists
  because a creative SPENT (> 0) inside a campaign in the selected range, under
  the resolved Excluded toggle; nothing on the page is ever edited and every
  control is a VIEWING tool. Nodes are NOT draggable, connectable or selectable
  (React Flow makes that a first-class prop — it isn't awkward), and no
  position is ever saved: these are facts, not a whiteboard.
  - **The dependency:** `@xyflow/react` `12.11.6`, exact-pinned, user-approved
    (see Stack for the justification line). ONE importer
    (`components/canvas/canvas-flow.tsx`), loaded via `next/dynamic` +
    `ssr: false` from `canvas-view.tsx`. Verified in the build: React Flow is a
    single lazy chunk (~57 kB gz + ~2.6 kB gz CSS) referenced only by
    `/canvas`'s loadable manifest — it is in NO route's first load, `/canvas`
    included, and the shared first-load JS did not move. Keep it that way: do
    not import `@xyflow/react` from a second module.
  - **Data — `canvasGraph()` (`db/queries/canvas.ts`).** ONE aggregation scan
    builds every edge and both node sets (`max: 1` discipline); statuses derive
    from the cached status inputs (never another status scan). **"Active but
    idle" creatives** — live by status, no edge in the range — are included as
    unconnected nodes so their insight chip has something to focus; they cost
    one PK lookup on `creatives`, and only when there are any. **Node totals
    are the entity's TRUE range spend under the SQL-level filters** — the
    status filter and the scale cap only HIDE things, they never restate a
    number, so "42% of this campaign's spend" stays honest whatever is shown.
    With a platform filter, a creative's status is the roll-up over the
    SELECTED platforms (the Library's rule), or a TikTok-only creative would
    read "active but idle" on an Instagram canvas when it is merely filtered
    out. The range is resolved server-side (`resolvePreferredRange` → last 30
    days); creative statuses default to everything but Terminated. **Google is
    ordinary data here** — the canvas is about who spent where, which google
    reports like everyone else, so its filter offers `ALL_PLATFORMS`.
  - **TWO CLOCKS, LOCKED (user-confirmed — do not merge them).**
    (1) The **RANGE** (date picker) decides whether an edge EXISTS: any spend
    for the (campaign, creative) pair inside it draws the edge. (2) The
    **STATUS WINDOW** decides whether that edge is **LIVE** — the pair's last
    spend day within `accounts.status_window_hours` of the campaign's
    platform's OWN latest spend day. That is the system's one freshness rule
    applied to a pair: `edgeIsLive` IS `deriveCampaignStatus`, not a copy.
    **LIVE** draws solid, full platform color; **PAUSED HERE** (spent in the
    range, not in the window) draws dashed at ~45%. The query serves both from
    ONE scan: it is bounded BELOW by the range start only, the in-range sums
    are `scopedMetrics`-FILTERed to `date <= to`, and the pair's last
    real-spend day is read from the same rows UNCLIPPED — because "live" means
    spending NOW, so an old range whose pair still runs today reads live, and
    "paused here since <date>" never names a date the pair spent past. `HAVING`
    in-range spend > 0 keeps existence on the range clock (later spend alone
    draws nothing). Liveness is judged in JS against the cached
    `platformSpendFreshness()` — no second scan.
  - **Layout — TRIPARTITE, by hand, NO layout engine** (`lib/canvas.ts`, pure,
    unit-tested; a user decision). Campaigns in the CENTER by spend desc;
    creatives flank them BY TYPE — **video RIGHT, everything else LEFT**
    (`creativeSide`). The BARYCENTER heuristic (average row of the campaigns
    feeding each creative) runs PER SIDE against the center so edges cross
    less; ties by spend then name for a stable order; idle creatives sit at the
    bottom of their own type's side. Edges route left → center and center →
    right (a left-flank creative is the React Flow SOURCE), the left flank is
    right-aligned and the right flank left-aligned, so every edge leaves from
    the side facing the center however wide its node is. Edge width =
    sqrt(spend) inside a min/max, colored by the CAMPAIGN's platform var.
  - **Node visuals (all user-approved).** **STATUS BORDER is the headline
    signal** — 2px in the status color (`STATUS_DOT` / `CAMPAIGN_STATUS_DOT`),
    measured ≥ 3.37:1 against both the node surface and the canvas on all four
    themes. The status WORD rides inside too; the old inner dot is gone — a
    second color-coded mark tells a colorblind reader nothing the border hadn't
    already failed to. **SIZE BY SPEND**: `nodeScale` = sqrt(spend) against the
    biggest node OF THE SAME KIND (campaign totals dwarf creative ones), within
    0.85–1.45; the body is laid out once at the base size and scaled whole, so
    box and type grow together; sizes feed the layout's spacing (each column
    stacks by its nodes' own heights) so rows never collide. **CAMPAIGN HEALTH
    "3/5"** = creatives with a LIVE edge to this campaign / creatives that
    spent there in the range (`campaignHealth`, from edge liveness — one
    source), counted over EVERY scanned edge, so like the totals it is a fact
    the status filter and the scale cap can't restate. **HOVER PRE-FOCUS**: a
    lighter preview of click-focus — the node's edges go full strength and the
    rest dims only to 70%; an active click-focus always wins (the hover id is
    ignored while one is set).
  - **The legend is non-optional**: bottom-left, collapsed to a "?" chip by
    default, remembered per browser (`cw-canvas-legend`). It states every
    encoding — border = status, solid vs dashed = live vs paused here, size and
    line weight = spend, line color = platform. The four corners each have one
    job: search · zoom · legend · minimap; nothing covers React Flow's
    attribution.
  - **Nodes have KNOWN dimensions AND carry `measured`.** The node list is
    rebuilt on every focus/hover change and culled off-screen
    (`onlyRenderVisibleElements`), so React Flow would otherwise have no
    measured size for most nodes — and `fitView({ nodes })` silently IGNORES a
    node without one (the minimap was empty and an insight chip snapped the
    viewport to identity). Supplying `width`/`height`/`measured` from the
    layout boxes fixes both. **The flip side, caught in C1.5: the INITIAL fit is
    done by hand.** With `measured` supplied, React Flow's own `fitView` prop
    resolves the instant nodes exist — BEFORE the pane has been measured (store
    width 0) — and frames the graph against nothing; C1 shipped under-zoomed on
    desktop because of it. `canvas-flow.tsx` fits in an effect gated on the
    store's pane size, and again whenever the graph changes. Don't restore the
    `fitView` prop.
  - **Focus** = the primary node(s), every edge touching one, and the
    neighbours at the other end (`focusFor`); everything else dims to 15%.
    Click a node, pick a search result, or click an insight chip (those two
    also pan/zoom to the subgraph); empty-canvas click or Esc clears.
    Double-click opens the entity's detail page.
  - **The insights strip TELLS you the patterns** (`canvasInsights`, pure,
    computed from the same graph the canvas draws so a chip can never point at
    a missing node): **campaigns with no live creatives** (every edge into them
    is paused here — the health count reads 0/N; defined on edge liveness, the
    same source as the health count, which superseded C1's child-general-status
    rule) · active creatives idle in the range · the most-shared creative (≥ 2
    campaigns; ties to the bigger spender). Zero-case chips are absent.
  - **Scale cap: ~400 nodes / ~800 edges** (`capEdges`) — keep the TOP edges by
    spend and SAY SO ("showing the top N of M connections by spend"); idle
    creatives that don't fit the node budget are counted in the same note.
    Never a hairball, never a silent truncation.
  - **Theming:** React Flow's chrome is re-pointed at the app's tokens through
    its `--xy-*` CSS variables (canvas = `--background`, minimap/controls =
    `--surface`, edges via the platform vars), so all four themes hold. The
    top-bar screenshot button captures the canvas faithfully — React Flow
    renders DOM + SVG, and `modern-screenshot` handles both (verified).
  - **C2 (pending): cluster views.** C1/C1.5 are the Network view only.

- **The Library's status STRIP is a FACET of the listing, not a query
  (2026-09).** It sits directly ABOVE the list (both views), not in the page
  header, because it describes what you are looking at and must move when the
  filters move. Its counts come back on `listCreatives().breakdown`, computed
  in JS from the rows that call already matched — **after every other filter,
  BEFORE the status filter narrows them**. That ordering IS the behaviour:
  selecting "Active" must not zero the other chips, or there would be no way
  back. Consequences: it costs NO query (the old `creativeStatusBreakdown()`
  and its per-platform half are gone — the strip's platform row went with them,
  a user decision), and it can never disagree with the table below it. The pure
  counter is `statusBreakdownOf` in lib/creative-status.ts.

- **Status maps derive from the request's cached `brandStatusInputs()` — never
  add another status scan (2026-09 perf pass).** Status is computed on nearly
  every page and each consumer used to run its own three scans of
  `performance_records`. `brandStatusInputs()` (React `cache()`, per request, in
  `db/queries/creative-status.ts`) now fetches per-creative activity,
  per-platform freshness and overrides ONCE, unrestricted; every status map is
  derived from it in JS. Campaign status keeps its own activity scan (it groups
  by campaign, not creative) but shares `platformSpendFreshness()`. The `asOf`
  point-in-time variant is the ONE sanctioned exception — it reconstructs a past
  day and can't read today's numbers. Corollary: **don't narrow a shared scan
  with a big `IN (…)`** — pass no ids and filter the map in JS. Remember
  `lib/db.ts` is `max: 1`, so `Promise.all` is serial: fewer queries is the only
  lever, not more concurrency. `tests/db/status-cache.test.ts` pins this by
  counting round-trips.

