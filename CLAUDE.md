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
- Auth.js v5 (Google provider, domain-restricted)
- Tailwind + shadcn/ui + shadcn charts (Recharts under the hood)
- TanStack Query (client data), TanStack Table (tables)
- papaparse (CSV), Zod (validation), framer-motion (motion)
- Vercel hosting, Vercel Blob (thumbnails), Vercel KV (upload session cache)

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
- `performance_records` has a unique constraint on `(creative_id, platform, date)`. Never bypass it. Validation is the only entry path; rollback is the only exit path.
- Every creative has a required `product_id`. Products live in their own table and are managed in `/admin/products`. Never let a creative be saved without one.

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

## Learned

(empty for now — add corrections here as they happen)
