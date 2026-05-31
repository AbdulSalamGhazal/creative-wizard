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
- Vercel hosting. (Vercel Blob/KV are NOT used — removed; upload-validation sessions live in Postgres. Thumbnails are URL fields, no blob storage yet.)

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
- `performance_records` is **unique** on `(creative_id, platform, campaign_name, date)` — the same creative can run on the same platform/date across different campaigns (distinct rows), but not the same campaign twice. Validation is still the only **entry** path. There are two sanctioned **exit** paths: (1) batch rollback within 24 h (admin-only), and (2) the record-cleanup tool on `/uploads` (filtered hard-delete, editor-or-admin, preview-then-confirm, audit-logged via `upload.bulk_delete`). No other code should delete from `performance_records`.
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

- **Campaign name + duplicate detection (v2).** `performance_records.campaign_name`
  stores the combined `Campaign ➤ Adset` value. Duplicates are keyed on
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
