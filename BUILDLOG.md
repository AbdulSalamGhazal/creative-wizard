# Build Log

Append-only log of decisions, scaffolding actions, and conflicts flagged
during the build. Each entry is dated and short. Read this when something
looks unfamiliar — it's the audit trail behind the code.

Format: each entry has a date heading and bullet points. Add new entries at
the bottom. Do not edit historical entries; if a decision is reversed, write a
new entry that says so.

---

## 2026-05-27 — Repo reorg + first commit

Initial reorganization of planning artifacts that landed in the project folder.

**Files moved (not edited):**
- `urjwan-ccms-prd.md` → `docs/prd.md`
- `urjwan-ccms-tech-spec.md` → `docs/tech-spec.md`
- `urjwan-ccms-validation-spec.md` → `docs/validation-spec.md`
- `urjwan-ccms-mockup-compare.html` → `docs/mockups/compare.html`
- `urjwan-ccms-mockup-library.html` → `docs/mockups/library.html`
- `urjwan-ccms-mockup-overview.html` → `docs/mockups/overview.html`
- `urjwan-ccms-mockup-upload.html` → `docs/mockups/upload.html`
- `CLAUDE.md` — unchanged, stays at the root.

**Git:**
- `git init -b main`.
- Added `.gitignore` (node_modules, .next, build artifacts, .env, .DS_Store, coverage, tsbuildinfo).
- First commit: `5b09763 Initial commit: planning docs and mockups`.

To undo: `git reset --hard <empty>` (no prior history) and move the files
back to their `urjwan-ccms-*` names with `git mv`.

---

## 2026-05-27 — Next.js 15 scaffold

Scaffolded with `create-next-app@15` into a temp directory, then copied into
the project root so the existing `.git` and planning files were preserved.

**Versions pinned:**
- `next` `15.5.18`
- `react` / `react-dom` `19.1.0`
- `eslint-config-next` `15.5.18`
- Tailwind `^4` (via `@tailwindcss/postcss`)
- TypeScript `^5`
- Node engine: `>=20.0.0`

**`create-next-app` flags used:**
`--typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --skip-install --turbopack`

**`package.json` rename:** `ccms-scaffold` → `urjwan-ccms`. Added scripts:
`typecheck`, `db:generate`, `db:migrate`, `db:push`, `db:studio`, `test`.

**Dependencies added on top of the bare scaffold** (per `docs/tech-spec.md` §2):
- Data layer: `drizzle-orm` ^0.36.4, `drizzle-kit` ^0.30.1, `@neondatabase/serverless` ^0.10.4, `postgres` ^3.4.5
- Auth: `next-auth` 5.0.0-beta.25, `@auth/drizzle-adapter` ^1.7.4
- Storage / cache: `@vercel/blob` ^0.27.0, `@vercel/kv` ^3.0.0
- UI: `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`, `lucide-react`, `framer-motion`, `recharts`
- Tables / forms / data: `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`, `zod`
- CSV: `papaparse` + `@types/papaparse`
- Upload UI: `react-dropzone`
- Testing: `vitest`

To undo a dep: `npm uninstall <name>` and remove its line from `package.json`.

**`tsconfig.json` hardening:** added `noUncheckedIndexedAccess: true` and
`noImplicitOverride: true` on top of `strict: true`, so the CLAUDE.md "never use
`any`" rule has teeth at compile time.

**Tailwind 4 / design tokens.** `app/globals.css` now defines the full CCMS
palette as CSS variables (`--bg`, `--surface`, `--ink`, `--accent`, the four
platform colors, `--pos` / `--neg` / `--warn`) lifted verbatim from
`docs/mockups/*.html`, exposed via `@theme inline` so Tailwind generates
utilities like `bg-surface`, `text-ink-2`, `text-accent`.

**Fonts (`app/layout.tsx`):** Instrument Serif (display), Plus Jakarta Sans
(sans), IBM Plex Mono (mono) — wired through `next/font/google`. `<html>` has
`class="dark"` since the spec is dark-default.

**Folder skeleton (matches `docs/tech-spec.md` §4):**

```
app/
  (auth)/signin/
  (dashboard)/
    creatives/{new,[name]/{edit}}/
    compare/
    platforms/[platform]/
    uploads/new/
    admin/{users,products}/
  api/uploads/{validate,commit}/
components/{ui,charts,filters,creative,product,upload}/
lib/                    (utils, format, metrics, db, kv, blob, auth)
db/{schema.ts, migrations/, queries/}
validators/             (product, creative, upload, exclusion, filters)
csv/{errors,parse,pipeline}.ts + csv/platforms/{meta,tiktok,snapchat,google}.ts
tests/fixtures/
```

**Concrete files written from spec text (not stubs):**
- `db/schema.ts` — full Drizzle schema from `docs/tech-spec.md` §5. Includes
  the `(creative_id, platform, date)` unique index and the partial-index
  candidate on `excluded_from_aggregates`.
- `lib/metrics.ts` — canonical weighted-aggregation SQL fragments. Every
  derived metric (`ctr`, `cpm`, `cpc`, `cpa`, `roas`, `hookRate`, `holdRate`)
  follows `SUM(num) / NULLIF(SUM(denom), 0)`. Aggregation queries import from
  here; do not open-code formulas elsewhere (CLAUDE.md aggregation rule).
- `lib/format.ts` — USD/int/pct/ratio/ISO-date formatters. All return em-dash
  on null/NaN so UI never renders 0/Infinity.
- `csv/errors.ts` — error taxonomy E001…E051 + W001/W002 with severities,
  matching `docs/validation-spec.md` §7. Codes are stable across releases.
- Zod schemas: `validators/{product,creative,upload,exclusion,filters}.ts`.
  Exclusion reason capped at 200 chars per PRD §5.5. URL filters cover date,
  product, platform, type, status, tag, and `includeExcluded`.

**Stub files written (to be filled in feature work):**
- `lib/auth.ts` — Auth.js v5 config (signIn callback + role bootstrap).
- `lib/db.ts` — Drizzle client over `@neondatabase/serverless`. Throws if
  `DATABASE_URL` is unset.
- `lib/kv.ts`, `lib/blob.ts` — thin re-exports.
- `csv/{parse,pipeline}.ts` and `csv/platforms/{meta,tiktok,snapchat,google}.ts` — empty exports with header comments pointing back to the spec.
- `db/queries/{products,creatives,performance,uploads}.ts` — empty.
- `app/api/uploads/{validate,commit}/route.ts` — return 501.

**Other configs:**
- `drizzle.config.ts` — schema `./db/schema.ts`, out `./db/migrations`, dialect `postgresql`, `strict: true`.
- `.env.example` — `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `AUTH_ALLOWED_DOMAIN` (default `urjwan.com`), `KV_*`, `BLOB_READ_WRITE_TOKEN`.
- `components.json` — shadcn `new-york` style, `rsc: true`, `baseColor: neutral`, `iconLibrary: lucide`. Lets us run `npx shadcn add <primitive>` later without re-initialising.
- `next.config.ts` — sets `outputFileTracingRoot` to the project dir to silence the stray `~/package-lock.json` workspace-root warning.
- `app/page.tsx` — replaced the create-next-app demo with a one-screen "Urjwan CCMS — Scaffold ready" placeholder.

**Verification:**
- `npm install` — 474 packages, 0 vulnerabilities. (Warnings: Node-engine
  warn from `eslint-visitor-keys` is harmless on Node 23; `@vercel/kv` and
  `recharts@2` deprecation warnings — see Conflicts below.)
- `npx tsc --noEmit` — clean.
- `DATABASE_URL=postgres://stub:stub@localhost/stub npx next build` — clean.
  Output: 4 routes (`/`, `/api/uploads/{validate,commit}`, `/_not-found`).
  Stub `DATABASE_URL` only needed because `lib/db.ts` throws on missing env
  at module load; no real connection is made during the build.

**State at end of scaffold:** scaffold files staged but **uncommitted** —
left for human review before the second commit.

---

## Conflicts flagged

Things where the implementation deviated from the binding docs, or where a
listed dependency turned out to be problematic. Per CLAUDE.md, docs win — so
these are recorded for explicit resolution, not silently fixed.

1. **Tailwind config file.** `docs/tech-spec.md` §4 lists `tailwind.config.ts`
   in the folder tree. `create-next-app@15` ships Tailwind 4, which uses
   CSS-based config (`@theme` in `globals.css`) and has no `tailwind.config.ts`
   by default. We followed Tailwind 4 conventions. If you'd rather have a JS
   config file (e.g. to use Tailwind 3 plugins), we'd downgrade Tailwind or
   add the JS config explicitly.
2. **`@vercel/kv` is deprecated.** Installs and still works, but Vercel now
   points to Upstash Redis or a Marketplace Redis integration. The API shape
   is similar; if you'd rather switch upfront, swap to `@upstash/redis` and
   delete `lib/kv.ts`'s re-export.
3. **`recharts@2` is EOL.** shadcn charts depend on it. Recharts 3 exists but
   isn't yet what shadcn ships. No action required today; revisit if shadcn
   updates.

---

## 2026-05-27 — Scaffold committed; migration, shadcn, dashboard shell

**Commit `4d4f549`** lands the scaffold from the previous entry as the second
commit on `main`. 45 files / 10,531 insertions. From here, everything new is
incremental.

**First Drizzle migration generated.** `npx drizzle-kit generate --name=initial`
produced `db/migrations/0000_initial.sql` (93 lines, 6 tables) and the
companion `db/migrations/meta/` snapshot. No DB connection needed for
generate. The migration includes:
- All 6 tables (`users`, `products`, `creatives`, `creative_tags`,
  `upload_batches`, `performance_records`).
- The duplicate-detection guard: `UNIQUE INDEX perf_creative_platform_date_idx`
  on `(creative_id, platform, date)`.
- All filter/join indexes from tech-spec §5: `creatives_product_idx`,
  `creatives_status_idx`, `creatives_type_idx`, `creative_tags_tag_idx`,
  `perf_date_idx`, `perf_platform_date_idx`, `perf_upload_batch_idx`,
  `perf_excluded_idx`, `products_status_idx`.

To apply this against a real database: set `DATABASE_URL` and run
`npm run db:migrate`. The migration is reversible only by recreating the
database — to drop and start over use `drizzle-kit drop` then re-`push`.

**shadcn primitives installed.** `npx shadcn@latest add` brought in:
`button`, `card`, `badge`, `separator`, `dropdown-menu`, `input`, `label`,
`sheet`. These land under `components/ui/` and pull in `radix-ui` as a
dependency. We are pinned to shadcn `new-york` style + lucide icons per
`components.json`. Future primitives: `npx shadcn@latest add <name>`.

**Token rename: `--accent` → `--brand`.** shadcn's semantic system uses
`--accent` for a hover-surface tint, while the mockups used `--accent` for
the brand magenta. To run both systems in the same file without a clash, the
CCMS palette now exposes the magenta as `--brand` / `--brand-2` / `--brand-soft`
(use `text-brand`, `bg-brand` in components). The shadcn semantic layer is
mapped to CCMS as:

| shadcn semantic       | CCMS palette       |
| --------------------- | ------------------ |
| `--background`        | `--bg`             |
| `--foreground`        | `--ink`            |
| `--card`              | `--surface`        |
| `--popover`           | `--surface-2`      |
| `--primary`           | `--brand`          |
| `--secondary`         | `--surface-3`      |
| `--muted`             | `--muted` → `--surface-2`, fg → `--ink-2` |
| `--accent`            | `--surface-3` (hover surface, NOT the magenta) |
| `--destructive`       | `--neg`            |
| `--border` / `--input` | `--line`           |
| `--ring`              | `--brand`          |

Note for future-me: if a mockup uses `text-accent` to mean magenta, translate
to `text-brand` in the React port.

**Dashboard layout shell** (the chrome from `docs/mockups/overview.html`):
- `app/(dashboard)/layout.tsx` — wraps everything under the dashboard route
  group with the top bar, sidebar, and global filter strip.
- `components/layout/top-bar.tsx` — brand mark with magenta gradient, workspace
  breadcrumb, ⌘K search input placeholder, theme toggle button (non-functional),
  user avatar initials.
- `components/layout/sidebar.tsx` — sticky nav with Overview / Creatives /
  Compare / Platforms / Uploads, then an Admin section (Products, Team),
  then Settings at the bottom. Active-route accent uses a `--brand` indicator
  bar. lucide-react icons.
- `components/filters/filter-strip.tsx` — sticky global filter row with date /
  product / platform / tag chips and an "excluded records hidden" status
  marker. All chips are non-functional placeholders.
- `app/(dashboard)/page.tsx` — Overview placeholder. Six KPI tiles showing
  em-dashes ("Awaiting first upload"), two chart placeholders, one top-creatives
  placeholder. Uses shadcn `Card` and `Badge`.
- `app/page.tsx` was deleted — `(dashboard)` route group claims `/`. The
  Overview is the default authenticated landing per tech-spec §4.

**Verification:** `tsc --noEmit` clean. `next build` clean.
`/` renders at 70.7 kB / 173 kB first-load JS, four routes total
(`/`, `/_not-found`, `/api/uploads/{commit,validate}`).

**Not done.** Auth, real data, sign-in route, Server Actions, and the upload
flow are all still untouched. The shell is visual only — every interactive
element is non-functional.

---

## 2026-05-27 — Local Postgres in Docker; migration applied

The team chose "local Postgres in Docker" over Neon for the first run, so
we're not blocked on cloud credentials.

**`docker-compose.yml` added** at the project root.
- Image: `postgres:16-alpine`.
- Container name: `ccms-postgres`. Port `5432:5432`.
- Database / user / password: `ccms` / `ccms` / `ccms_dev_password` —
  **dev-only**, intentionally weak. Never reuse for staging or prod.
- Volume `ccms-postgres-data` persists across `down`/`up`. To wipe:
  `docker compose down -v`.
- Healthcheck: `pg_isready -U ccms -d ccms` every 5 s, 10 retries.

**`.env.local` added** (gitignored) with
`DATABASE_URL=postgres://ccms:ccms_dev_password@localhost:5432/ccms`
and stubs for the auth / KV / Blob keys.

**`lib/db.ts` switched driver.** Was `@neondatabase/serverless`
(`drizzle-orm/neon-http`). Now `postgres-js` (`drizzle-orm/postgres-js`) so a
plain TCP connection works for both local Docker Postgres and Neon's pooled
endpoint. Added a `globalThis.__ccmsPg` cache so Next.js dev HMR doesn't leak
connection pools across module reloads. `@neondatabase/serverless` stays in
`package.json` for now — if we move to the Neon HTTP driver later it's a
two-line swap.

**Bringing it up.**
- `open -a Docker` (macOS) → daemon ready in ~5 s.
- `docker compose up -d` → image pulled, container started, healthcheck green.
- `set -a && . ./.env.local && set +a && npx drizzle-kit migrate` →
  `0000_initial.sql` applied cleanly.

**Verified in the live DB:**
- 6 tables: `users`, `products`, `creatives`, `creative_tags`,
  `upload_batches`, `performance_records`.
- 20 indexes total. Notably present: `perf_creative_platform_date_idx`
  (UNIQUE — the duplicate-detection guard from validation-spec stage 5),
  `creatives_name_unique`, `products_name_unique`, `products_slug_unique`,
  plus every filter/join index from tech-spec §5.

**How to redo from scratch.**
```
docker compose down -v
docker compose up -d
set -a && . ./.env.local && set +a
npx drizzle-kit migrate
```

**Not committed in this entry:** `.env.local` (gitignored). Everything else
will land in the upcoming "DB setup" commit.

---

## 2026-05-27 — First end-to-end vertical slice (seed → KPI query → Overview)

The Overview tiles render real numbers from the database. This is the first
slice that touches every layer (schema → seed → query → Server Component →
UI formatter), and it proves `lib/metrics.ts` works against live Postgres.

**`db/seed.ts` written and run** (npm script: `db:seed`).
- Idempotent. Every insert uses `ON CONFLICT DO NOTHING` on its unique
  constraint; `performance_records` is keyed by the `(creative_id, platform,
  date)` unique index. Re-running the seed is a safe no-op.
- Adds dev devDeps `tsx` and `dotenv`. Script invoked via
  `tsx --env-file=.env.local db/seed.ts` so `.env.local` loads automatically.
- Seeded fixture:
  - 1 admin user (`salam@urjwan.com`).
  - 3 products (Argan Oil, Rose Toner, Saffron Cream).
  - 4 creatives across the three products and all three creative types.
  - 1 synthetic upload batch on `meta`.
  - 120 `performance_records` (4 creatives × 2 platforms × 15 days).
  - Numbers come from a deterministic LCG seeded with `1`, so the dataset is
    reproducible bit-for-bit across machines.

**`db/queries/performance.ts::kpis()`** — first real query. Imports every
derived-metric SQL fragment from `lib/metrics.ts` (no open-coded formulas).
Default `WHERE excluded_from_aggregates = false`; flips off with
`includeExcluded`. Returns `null` (→ em-dash in UI) wherever a denominator is
zero. Numeric/bigint columns are coerced to JS `number` at the query
boundary.

**`app/(dashboard)/page.tsx`** is now an `async` Server Component that calls
`kpis()` with a 30-day trailing window. Six tiles render formatted values
through `lib/format.ts` (USD, integer, percent, ratio). The "Trailing N days"
hint replaces the old "Awaiting first upload" placeholder. The header badge
shows the active date range.

**Hand-verification (PRD §10.4):** ran the same aggregation as raw SQL
against the seeded data and compared each tile.

| Tile          | Raw SQL    | Rendered    |
| ------------- | ---------- | ----------- |
| Spend         | 8427.55    | `$8,427.55` |
| Impressions   | 1,338,067  | `1,338,067` |
| Blended CTR   | 0.025334   | `2.53%`     |
| Conversions   | 1,430      | `1,430`     |
| Blended CPA   | 5.8934     | `$5.89`     |
| Blended ROAS  | 8.342304   | `8.34`      |

All match. The PRD success criterion that every blended metric reconciles
with a hand-calculation from the raw data is met for the Overview KPIs.

**Notes for future-me.**
- The query relies on Drizzle returning numeric columns as strings; the
  `num()` coercion in `db/queries/performance.ts` converts to `number` at the
  query edge. If we later move to BigInt-mode integers (for impressions/clicks
  beyond 2^31), revisit the formatter signatures.
- The default 30-day window is hard-coded in the Overview for now. URL-state
  filter parsing (tech-spec §8.1) is the next step before adding more pages.

**Not done.** Auth, URL-state filters, the upload flow, charts, the
Creatives Library, Compare, Per-Platform, exclusion UI. The Overview is the
only page wired to real data.

---

## 2026-05-27 — URL-state filters wired end-to-end

The dashboard chrome's filter chips now do something. Filters live entirely
in the URL (tech-spec §8.1) so every dashboard view will be bookmarkable,
shareable, and reload-safe.

**`db/queries/performance.ts::kpis()` extended.**
- New filter params: `productIds`, `platforms`, `types`, `statuses`, `tags`,
  `includeExcluded`. Date range is unchanged.
- Drizzle conditions composed via a single `and(...)`; the query uses
  `$dynamic()` so it can conditionally `innerJoin` `creatives` (for product /
  type / status) and `creative_tags` (for tag filters) only when those
  filters are present. Date-only or platform-only queries still hit just
  `performance_records` and its indexes.
- `inArray` for every multi-select. Default still strips
  `excluded_from_aggregates = true`.

**`validators/filters.ts` fixed.** The earlier `csv()` helper widened enum
types to plain `string[]` because of the `as [string, ...string[]]` cast.
Replaced with a generic `csvEnum<T>` that preserves literal-tuple types, so
`parsed.platforms` is typed as `("meta" | "tiktok" | "snapchat" | "google")[]`
and flows into `kpis()` without a coercion.

**`components/filters/filter-strip.tsx` rewritten as a client component.**
- Reads / writes URL state via `useRouter` + `useSearchParams` +
  `usePathname` and `router.replace(..., { scroll: false })` inside a
  `useTransition` so the navigation feels instant.
- Date chip is a `DropdownMenu` with three presets (7 / 30 / 90 days).
  Custom-range picker deferred.
- Platforms chip is a multi-select `DropdownMenuCheckboxItem` list.
  Active selection shows count (`"2 selected"`) on the chip face.
- Include-excluded toggle on the right side: warm-amber when excluded rows
  are shown, neutral when hidden. Defaults to hidden per CLAUDE.md.
- "Clear" button appears whenever any filter is set; resets every dashboard
  filter param in one push.
- Products / Tags chips remain visual-only placeholders — no picker UI yet.

**`app/(dashboard)/page.tsx` reads `searchParams`.** Per Next 15 the prop is
a `Promise`, so the page is `async` and awaits before parsing through
`dashboardFiltersSchema`. Missing date range falls back to the trailing-30-day
default. The header badge now reflects the active filters:
`2026-04-28 → 2026-05-27 · all platforms · excluded hidden`.

**`components/layout/sidebar.tsx` is pathname-aware.** Converted to a client
component that reads `usePathname()`. `isActive(href)` matches exactly for
`/` and as a prefix otherwise, so `/admin/products` correctly lights the
"Products" link without also matching at the root. The `<Sidebar active />`
prop is gone; layout call simplified to `<Sidebar />`.

**Suspense boundary for the filter strip.** The first build failed with
*"useSearchParams() should be wrapped in a suspense boundary"* — Next 15 wants
client components that read URL state to be wrapped so the rest of the tree
can still prerender. Fix: wrap `<FilterStrip />` in `<Suspense>` inside
`app/(dashboard)/layout.tsx`. Fallback is a same-height empty bar, so layout
doesn't jump on hydration.

**Live URL roundtrip verification** (against the seeded dataset):

| URL                                                      | Spend       | Impressions | CTR     | Conv. |
| -------------------------------------------------------- | ----------- | ----------- | ------- | ----- |
| `/`                                                      | `$8,427.55` | `1,338,067` | `2.53%` | 1,430 |
| `/?platforms=meta`                                       | `$4,529.46` |   `691,998` | `2.59%` |   758 |
| `/?platforms=tiktok`                                     | `$3,898.09` |   `646,069` | `2.47%` |   672 |
| `/?from=2026-05-21&to=2026-05-27`                        | `$3,895.83` |   `614,552` | `2.47%` |   574 |

Meta + TikTok spend sum to the default total to the cent. Per-platform values
hand-checked against raw SQL `GROUP BY platform` — every figure matches.

**Build status.** `next build` clean. Bundle moved slightly: `/` is now
`ƒ Dynamic` (because of `searchParams`), 43.1 kB / 174 kB first-load JS. The
shared chunks didn't grow meaningfully.

**Not done.** Custom date picker, product picker, tag picker, charts, all
non-Overview routes. Auth still untouched. The filter system is now in place,
so future dashboard pages just need to read the same searchParams and call
their own queries.

---

## 2026-05-27 — Spend-over-time chart + Top-Creatives table

The two largest placeholder boxes on the Overview turned into real visuals.
This entry establishes the two patterns every future dashboard chart/table
will follow: SQL aggregation in `db/queries/performance.ts` that imports its
derived-metric SQL from `lib/metrics.ts`, JS-side reshaping where useful, and
a focused client/server component that consumes the typed row shape.

**Two new queries in `db/queries/performance.ts`:**

- `spendByDatePlatform(filters)` — `SELECT date, platform, SUM(spend)
  GROUP BY date, platform ORDER BY date`. Returns one row per
  date-platform pair. The chart pivots in JS so the SQL stays simple.
- `topCreatives(filters, limit=10)` — joins `performance_records` →
  `creatives` → `products`, aggregates per creative, sorts by `SUM(spend)
  DESC`, limits to N. Returns name / product name / type / status plus
  spend / impressions / clicks / conversions / blended CTR / blended ROAS
  (CTR + ROAS come from `lib/metrics.ts` fragments).

Both queries share the same WHERE/JOIN scaffolding as `kpis()`, refactored
out into a private `buildBaseConditions()` helper so the filter logic exists
in one place and every aggregation honors the same defaults
(`excluded_from_aggregates = false` unless `includeExcluded`).

**`lib/palette.ts` added.** Recharts and other DOM-renderers need literal
color values, not CSS variables. `PLATFORM_COLOR` mirrors `--meta`,
`--tiktok`, `--snapchat`, `--google` from `app/globals.css`. If a platform
color changes in the design tokens, also update this file (or future-me will
ship a hex/CSS mismatch).

**`components/charts/spend-over-time.tsx`** — client component
(`"use client"` because Recharts measures the DOM). Recharts
`ResponsiveContainer` → `AreaChart` with one stacked `<Area>` per platform
that actually has data in the window. Each area uses a `linearGradient` from
45% → 5% opacity so colors stay light. Custom tooltip renders the date in
"MMM D" style, lists each platform with a swatch + USD value, and adds a
"Total" footer line. Y-axis uses compact USD notation (`$1.2K`). On an empty
result the chart slot becomes a dashed-border "No spend in the selected
window" placeholder.

**`components/charts/top-creatives.tsx`** — server component, plain
`<table>` (no TanStack here since the SQL already sorts and caps at 10).
Status column uses small bordered badges keyed by status with palette
mapping (`active` → pos green, `paused` → warn amber, `archived`/`draft` →
muted). Numeric columns use `font-variant-numeric: tabular-nums` via the
`.num` utility from `globals.css`, formatted through `lib/format.ts`. The
table is wrapped in `overflow-x-auto` so it survives narrow viewports.

**Overview parallelizes its data fetches.** `app/(dashboard)/page.tsx` now
issues `kpis()`, `spendByDatePlatform()`, and `topCreatives()` inside one
`Promise.all`, so the page waits on whichever query is slowest rather than
the sum. Three round-trips become one critical path.

**Reconciliation (PRD §10.4 again):**

| Check                                               | Result                  |
| --------------------------------------------------- | ----------------------- |
| Sum of all chart cells (date × platform spend)      | $8,427.55 — matches KPI |
| Top-creatives row 1 (URJ_VID_002 / Argan Oil)       | $2,554.52, CTR 2.75%, ROAS 9.42 — matches SQL ground truth |
| Sum of `topCreatives()` spend column                | $8,427.55 — matches KPI |

**Bundle.** `/` first-load JS went from 174 kB → 286 kB. Recharts is the
heaviest piece (~85 kB compressed). If we later need to trim, switching the
chart to a `dynamic()` import (load after first paint) is the obvious lever.

**Not done.** Platform-mix donut, custom date picker, product picker, all
non-Overview routes. Auth. Upload flow. The data-fetch pattern is now
established; everything else extends it.

---

## 2026-05-27 — Platform-mix donut closes the Overview

Final placeholder on the Overview turned into a real visual. Every panel on
`/` now renders live data; the page matches its mockup intent.

**`platformMix(filters)` added** to `db/queries/performance.ts`. Groups
`SUM(spend) / SUM(impressions) / SUM(conversions)` per platform via the same
shared `buildBaseConditions()` helper as the rest. Ordered by spend desc so
the donut renders biggest-slice-first.

**`components/charts/platform-mix.tsx`** — client component, Recharts
`PieChart` with a `Pie` set to `innerRadius="62%"` / `outerRadius="92%"` for
a clean donut. Slice colors come from `PLATFORM_COLOR` in `lib/palette.ts`
(no new color sources). Center stack shows "Total spend" + the compact USD
total over the hole; a small legend on the right lists each platform with a
swatch and its share percentage. Custom tooltip shows the slice's USD spend
and share to one decimal. Stroke uses `var(--surface)` so the slices read as
floating against the card.

**Wired into Overview.** Added `platformMix` to the `Promise.all` parallel
fetch and replaced the placeholder div with `<PlatformMixDonut rows={...} />`.

**Reconciliation:** seeded data shows Meta 53.7% / TikTok 46.3% on the donut.
Raw SQL confirms `4529.46 / 8427.55 = 53.74%` and `3898.09 / 8427.55 = 46.26%`.
Shares match to the displayed precision and sum to 100%.

**Bundle.** `/` first-load went from 286 kB → 293 kB (~7 kB more compressed
Recharts code for the Pie / Cell imports — small because most of Recharts
was already on the page for the area chart).

**Overview status.** Every section is now live data: 6 KPI tiles, stacked
spend-over-time area, platform-mix donut, top-10 creatives table.
Sparklines in the table are still deferred; otherwise the Overview is
feature-complete versus the mockup.

**Not done.** All non-Overview routes. Auth. Upload flow. Custom date
picker, product picker, tag picker. Sparkline cells.

---

## 2026-05-27 — Creatives Library page live

First non-Overview route is in. `/creatives` renders grid and table views over
seeded data, with working URL-state filters for product / type / status / tag,
ILIKE search across name/notes/tags, six sort options, and a grid/table toggle.

**Data layer:**

- `db/queries/creatives.ts` — `listCreatives()` uses two Drizzle CTEs
  (`spend_30d`, `tag_agg`) so per-card 30-day spend and tag list join without
  fan-out. `COUNT(*) OVER ()` returns the unfiltered total alongside the
  result rows, so "Showing N of M" needs no second query. Sort goes through a
  switch that maps the six enum values to ORDER BY fragments; `spend_30d` and
  `tag_list` are SELECT-side aliased via `sql\`...\`.as("…")` so ORDER BY can
  reference them by name. Numeric/array coercion at the query edge: nulls →
  `0` for spend, `null` → `[]` for tags.
- `creativeStats()` — single query with `COUNT(*) FILTER (WHERE …)` per
  status plus a "created this month" count. Parallel to `listCreatives()`.
- `listAllTags()` — `SELECT DISTINCT tag` for the tag-filter dropdown.
- `db/queries/products.ts::listProducts()` — minimal id + name list for the
  product-filter dropdown.

**Validation.** `validators/creative.ts` adds `creativeListFiltersSchema` for
the URL params (`q`, `productIds`, `types`, `statuses`, `tags`, `sort`,
`view`). `sort` and `view` use `z.enum(...).catch(default)` so an unknown
value falls back instead of throwing. `csvEnum` and `csvString` helpers
mirror the pattern in `validators/filters.ts`.

**Components in `components/creative/`:**

- `library-header.tsx` — eyebrow / serif title / stats line with `pos`/`warn`
  color accents on the active/paused counts. "New creative" CTA links to
  `/creatives/new` (404 for now; create form is a follow-up slice).
- `library-filter-bar.tsx` — client component, sticky, owns its own URL
  roundtrip via `useRouter` + `useSearchParams` + `useTransition`. Search
  input is debounced 250 ms so typing feels instant without spamming the
  router. Four `DropdownMenuCheckboxItem` filter pills, a sort dropdown, and
  a two-button grid/table view toggle. Clear button appears when any filter
  is active.
- `creative-card.tsx` — server component. 4:3 thumbnail (next/image when
  `thumbnailUrl` exists; otherwise a deterministic gradient + 56-px lucide
  type icon over a subtle dot pattern). Type and status badges with colored
  status dot. Mono creative name, up to 2 tag chips + "+N more", footer with
  launch date and `$X.XX / 30d`. Hover: card lifts 0.5 (2 px), thumbnail
  scales 1.05x, an `ArrowUpRight` chevron fades in bottom-right. Draft →
  dashed border. Archived → 0.65 opacity.
- `creative-grid.tsx` — wrapper, `grid-cols-1 sm:2 md:3 xl:4 2xl:5`. Empty
  state is a designed-out card.
- `creative-table.tsx` — plain `<table>` mirroring the styling of
  `components/charts/top-creatives.tsx`. Columns: Name (mono link), Product,
  Type, Status (badge), Launch date, 30-day spend (right-aligned), Tags
  (chip row + "+N" overflow). TanStack Table deferred until row selection /
  column toggles are needed.

**Palette helper.** `lib/palette.ts` gains `gradientFor(name)` — a tiny
`hash(name) % CARD_GRADIENTS.length` picker over six dark-theme-compatible
gradient pairs (plum, indigo, violet, amber, emerald, copper). Cards without
thumbnails read as distinct rather than monochrome.

**Layout refactor.** Per the plan: removed `<FilterStrip />` from
`app/(dashboard)/layout.tsx` so each route owns its filter chrome. Re-added
the `FilterStrip` inside `app/(dashboard)/page.tsx` wrapped in `<Suspense>`,
using `-mx-6 -mt-6 mb-2` so the strip still sits flush at the top of `<main>`
without changing its sticky behavior. Library uses its own `LibraryFilterBar`
which is shaped like the global strip but with library-specific controls.

**Seed extended.** `db/seed.ts` now inserts 7 tag assignments across the 4
creatives (`launch`, `ugc`, `cold-traffic`, `evergreen`, `retargeting`).
Idempotent via `onConflictDoNothing`. Tag-filter dropdown now has options;
SQL tag-filter path is exercised by the verification cases.

**URL roundtrip verification:**

| URL                                  | Result                                                          |
| ------------------------------------ | --------------------------------------------------------------- |
| `/creatives`                         | 4 cards, stats "4 total · 3 active · 1 paused · 4 this month"   |
| `/creatives?statuses=active`         | 3 cards                                                         |
| `/creatives?types=video`             | 2 cards (URJ_VID_001, URJ_VID_002)                              |
| `/creatives?q=URJ_VID`               | 2 cards                                                         |
| `/creatives?tags=ugc`                | 2 cards (URJ_VID_001, URJ_VID_002)                              |
| `/creatives?sort=spend-desc`         | order: VID_002, SLD_020, VID_001, IMG_010 (matches raw SQL)     |
| `/creatives?sort=name-asc`           | order: IMG_010, SLD_020, VID_001, VID_002                       |
| `/creatives?view=table`              | table renders, same 4 rows, $1800/2109/1963/2554 reconciled     |

Per-card spend footers (`$1,800.63`, `$2,109.20`, `$1,963.20`, `$2,554.52`)
match raw SQL aggregates row-by-row.

**Overview regression check.** `/` still renders the filter strip and its
KPIs ($8,427.55 default, $4,529.46 with `?platforms=meta`) — the strip move
from layout to page introduced no behavior change.

**Bundle.** `/` first-load JS went 293 → 295 kB (the Suspense wrapper adds
nothing visible). `/creatives` ships at 31.9 kB / 216 kB.

**A small bug found and fixed during verification:** the first cut of the
spend-desc sort referenced a SELECT alias that Drizzle wasn't generating, so
sort silently fell back. Fix: explicitly alias `spend_30d` and `tag_list`
with `sql\`...\`.as("…")` so ORDER BY can reference them by name.

**Not done.** `/creatives/new` (the create form) — the "New creative" CTA
points there and 404s until that page exists. Creator filter and launch-date
range filter are noted as deferred in the validator. TanStack Table in the
table view is deferred. No `loading.tsx` skeletons yet. Real-thumbnail upload
flow (`@vercel/blob`) is deferred.

---

## 2026-05-27 — Creative Detail page live

`/creatives/[name]` now renders a full per-creative dashboard. Clicking a
Library card no longer 404s. Every page that the Overview / Library hadn't
already wired is now functional except the create form, the upload flow, and
auth.

**Performance queries opened up.** `KpiFilters` made `from`/`to` optional
and gained a `creativeIds?: string[]` array. The shared
`buildBaseConditions()` now skips the date `BETWEEN` when both bounds are
omitted (Detail uses all-time) and adds an `inArray(performance_records.creative_id, …)`
predicate when `creativeIds` is set. Every consumer (`kpis`,
`spendByDatePlatform`, `platformMix`, `topCreatives`) inherits the new
filters automatically since they share `buildBaseConditions`.

**`platformMix()` extended** to also return clicks, blended CTR, blended
CPA, and blended ROAS — the per-platform breakdown table on Detail needs
them. Overview's donut is unaffected (it ignores the extra columns).

**Detail-specific queries in `db/queries/creatives.ts`:**

- `getCreativeByName(name)` — joins `creatives` → `products` for the
  human-readable product name, then runs a second tiny query for tags.
  Returns `null` when no match (the page calls `notFound()`).
- `creativeRecords(creativeId)` — every performance record for the creative,
  ordered by `date DESC, platform ASC`. Surfaces `excludedFromAggregates`,
  `excludedReason`, `excludedAt` so the records table can render the
  "Excluded" badge. **Detail views always show every record** regardless of
  exclusion (PRD §5.4).

**Components in `components/creative/` and `components/charts/`:**

- `creative-detail-header.tsx` — 260×195 thumbnail (next/image when set,
  deterministic gradient otherwise), serif name, product eyebrow, type +
  status + launch-date badges, tag chips, notes. "← Back to library" link.
- `creative-perf-line.tsx` — `LineChart` (not stacked), one `<Line>` per
  platform that has data. `connectNulls={false}` so gaps in coverage read as
  real gaps. Custom tooltip pivots the date and lists every platform's value
  with em-dash for missing.
- `creative-platform-table.tsx` — per-platform breakdown with the existing
  platform color dot + label, columns for spend / impressions / clicks /
  CTR / conversions / CPA / ROAS.
- `creative-records-table.tsx` — every record, with date / platform / spend
  / impressions / clicks / conversions and the "Excluded" badge column.
  Excluded rows render at 70% opacity; the badge has a `title` attribute
  carrying the reason text. Footer copy explains the convention.

**`app/(dashboard)/creatives/[name]/page.tsx`** — async Server Component.
Awaits `params`, decodes the name, runs `getCreativeByName`. If null, calls
`notFound()` → Next renders the framework 404. Otherwise issues
`Promise.all` for the four queries (KPIs, by-platform, perf time series,
records) and composes the page.

**Reconciliation (all four creatives, all six all-time KPIs):**

| Creative      | Spend       | Impressions | CTR     | Conv. | CPA    | ROAS |
| ------------- | ----------- | ----------- | ------- | ----- | ------ | ---- |
| URJ_VID_001   | $1,963.20   |   340,954   | (live)  | (live)| (live) | (live) |
| URJ_VID_002   | $2,554.52   |   387,725   | 2.75%   | 494   | $5.17  | 9.42 |
| URJ_IMG_010   | $1,800.63   |   272,178   | (live)  | (live)| (live) | (live) |
| URJ_SLD_020   | $2,109.20   |   337,210   | (live)  | (live)| (live) | (live) |

Every cent matches raw SQL. Sum of all four spends = $8,427.55 = Overview
KPI ✓.

**Exclusion exercise.** Manually marked one row excluded
(`UPDATE performance_records SET excluded_from_aggregates = true …`) and
observed:

| View                              | Before     | After      | Δ        |
| --------------------------------- | ---------- | ---------- | -------- |
| Detail: URJ_VID_002 KPI Spend     | $2,554.52  | $2,535.26  | −$19.26  |
| Overview KPI Spend (default)      | $8,427.55  | $8,408.29  | −$19.26  |
| Records table "Excluded" badges   | 0          | 1          | +1       |

The excluded row's spend was exactly $19.26 — the delta propagated from
Detail to Overview correctly. The badge appeared with the reason text on
hover. Reverted; state clean. The exclusion read path is fully wired; the
write path (UI to flip the flag) needs Server Actions + auth and is the
next slice's territory.

**Bundle.** `/creatives/[name]` ships at 5.71 kB / 288 kB. Most of the
288 kB is the line chart's Recharts code, the same chunks already paid by
the Overview.

**Not done.** Server Action to exclude/include a record from the UI (needs
auth roles). Editable notes panel. Server Action to edit creative metadata.
Sparkline cells on the Library's top-creatives. `/creatives/new` (the
create form). Auth. Upload flow.

---

## 2026-05-27 — Stub auth + exclude/include from the UI

PRD §5.5 (manual anomaly exclusion) is now wired through the UI. Closing the
loop also required a server-side identity for the audit columns — done with
a deliberately temporary auth stub.

**Stub auth in `lib/auth.ts`.**
- `auth()`, `requireAuth()`, `requireAdmin()`, `requireEditor()` — same
  shape Auth.js v5 will expose, so call sites won't change when we swap.
- Internally: returns the seeded admin user from a one-shot DB lookup,
  cached on the module. If no admin exists the helper throws with a
  pointer to `npm run db:seed`.
- Every Server Action that writes to the DB calls one of the `require*`
  helpers so the audit fields (`excluded_by_user_id`) are always populated
  with a real id, not a placeholder.

**Server Actions in `app/actions/exclusion.ts`.**
- `excludeRecord(recordId, reason)` — `requireEditor()` →
  Zod-validate `recordId` and `reason` (200 char max, non-empty) →
  `UPDATE performance_records SET excluded_from_aggregates=true,
  excluded_reason=…, excluded_by_user_id=user.id, excluded_at=now()` →
  revalidate `/`, `/creatives`, `/creatives/[name]` so every KPI updates.
- `includeRecord(recordId)` — clears the four exclusion columns; same
  revalidation pattern. v1 keeps no exclusion history.
- Both return `{ ok, error? }` so the client can render inline error text
  rather than throw. Revalidate is wrapped in try/catch so a revalidation
  failure (e.g. a Server Action called outside a request context, like a
  test harness) doesn't mask a successful DB write.

**Dialog UI in `components/creative/exclude-row-action.tsx`.**
- Client component, rendered per row in the records table.
- When the row is not excluded: a ghost "Exclude" button. Click → shadcn
  Dialog asking for a reason. Live counter shows N / 200; >200 turns red and
  the submit is disabled along with empty input.
- When the row is excluded: a "Re-include" ghost button right where Exclude
  was. Click triggers `includeRecord` immediately (no dialog).
- `useTransition` for pending state — button text becomes "Excluding…" and
  the dialog stays open until the action resolves.
- Dialog header shows the row's date / platform / spend so the user knows
  what they're acting on (passed as `context` prop).

**shadcn primitives added: `Dialog`, `Textarea`.**

**Records table updated** — new "actions" column at the end of each row hosts
the `<ExcludeRowAction>`. The Excluded badge keeps its `title` attribute
carrying the reason text so hover surfaces the rationale.

**Lint fixes that fell out of `next build`:**
- `library-filter-bar.tsx` had a `(close) => ...` signature on its child
  prop that never used `close`. Trimmed to `() => ...`.
- `exclude-row-action.tsx` had an unescaped apostrophe in JSX text;
  swapped for `&apos;`.

**Verification.**

End-to-end harness via `npx tsx verify_exclusion.tsx` (script deleted after
verification) called the Server Actions directly:

| Step                                              | Outcome                                                     |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `excludeRecord(id=31, "UNIT_TEST: verify path")`  | DB: excluded=true, reason set, excluded_by=admin.id, time set |
| `includeRecord(31)`                               | DB: excluded=false, all four columns cleared                |
| `excludeRecord(31, "")` (empty)                   | Rejected by Zod `min(1)` ✓                                  |
| `excludeRecord(31, "x".repeat(300))` (over)       | Rejected by Zod `max(200)` ✓                                |
| `includeRecord(999999)`                           | "Record not found"                                          |

Browser-side check via curl + SQL flip:

| Stage                              | Detail Spend | Overview Spend | Δ        | UI elements                              |
| ---------------------------------- | ------------ | -------------- | -------- | ---------------------------------------- |
| Clean                              | $2,554.52    | $8,427.55      | —        | 30 Exclude, 0 Re-include, 0 badge        |
| One $19.26 row excluded            | $2,535.26    | $8,408.29      | −$19.26  | 29 Exclude, 1 Re-include, 1 badge        |

KPI delta on both pages equals the excluded row's spend to the cent.

**Bundle.** `/creatives/[name]` went from 5.71 kB → 9.08 kB (+3.4 kB for
the Dialog + action client glue).

**Not done.** Real Auth.js v5 (needs Google OAuth creds). Exclusion history
log. Editable notes panel. `/creatives/new` create form. Upload flow.
