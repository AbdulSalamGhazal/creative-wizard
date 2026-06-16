# Build Log

> **⚠️ Frozen as of 2026-06-16 — superseded by `git log` + `CLAUDE.md`.**
> This file is a historical record of the **May 2026 initial build phase only**
> (through "Drop auto-detect, force explicit platform pick", 2026-05-27). The
> June 2026 feature wave — multi-tenancy/brand switching, campaigns & portfolio,
> by-tag & video diagnostics, per-platform rating, status-flow, launches/fatigue,
> change-radar, the creative-detail overhaul, and the dynamic-status work — is
> **not** logged here. For changes after 2026-05-27, read the **git history**
> (every commit has a descriptive conventional message) and **`CLAUDE.md`** (the
> living architecture + "Learned" intentional-design notes). No new entries are
> added below; it is kept as a snapshot of how the foundation was built.

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

---

## 2026-05-27 — CSV upload foundation (parse + 5-stage pipeline + tests)

The validation pipeline from `docs/validation-spec.md` is in. Pure
data-layer slice — no UI, no route handlers, no DB writes. Sets up the
contract the upload form and route handlers will sit on top of.

**`csv/parse.ts` — papaparse wrapper.**
- 10 MB upper bound enforced up front (E001).
- UTF-8 decoded with `TextDecoder(..., { fatal: true })`. Non-UTF-8 returns
  E004. The Windows-1256 fallback (W001) is deferred until we add
  `iconv-lite`.
- BOM strip.
- Auto delimiter detection: if the first header line has no commas but
  contains a semicolon, papaparse is told to use `;`.
- Empty / whitespace-only inputs short-circuit to E003 (otherwise papaparse
  emits a confusing "no delimiter" parse error first).
- Returns `{ header: string[], rows: string[][], rowNumbers: number[], warnings }`
  on success or a single fatal error.

**`csv/platforms/types.ts` + four platform adapters.**
- Shared `PlatformAdapter` shape: `headerMap` (internal field → candidate
  header strings), `requiredFields`, `acceptedDateFormats`, optional
  `skipRow` rule.
- All four adapters (`meta`, `tiktok`, `snapchat`, `google`) populated with
  **plausible-but-placeholder** column names. The validation spec marks
  §9.1-9.4 as "pending real CSV samples"; these will be re-tuned once we
  have real exports. Each adapter exports a default + named binding;
  `csv/platforms/index.ts` exposes `ADAPTERS` keyed by platform.

**`csv/pipeline.ts` — 5-stage runner.**
- Stages 1-2 fail-fast, stages 3-5 collect.
- Stage 1: file integrity (delegated to `parseCsv`).
- Stage 2: schema. Case-insensitive header lookup, picks the first matching
  candidate per internal field, surfaces `E010` for missing required
  columns, `E012` for duplicate header columns, and `W002` warnings for
  unknown extra columns.
- Stage 3: per-row content. `E020` (unregistered creative — strict byte-equal
  NFC match per spec §4), `E021` (empty creative), `E030` (invalid date),
  `E031` (future date > 24h), `E040` (non-numeric), `E041` (negative),
  `E042` (missing required field). Optional numeric fields treat `""`,
  `"-"`, `"—"`, `"N/A"`, `"null"` as zero. Numbers tolerate commas,
  currency symbols, and trailing units (`"$1,234.56"`, `"1234 USD"`).
- Stage 4: intra-file duplicates by `(creative, date)` — emits a single
  `E050` per group with all row numbers.
- Stage 5: DB duplicates via injected `findExistingBatch()` callback —
  emits `E051` per existing row. Skipped for rows already covered by E050
  to avoid double-reporting.
- Subtotal rows (empty creative + empty date) are silently skipped per
  spec §6.
- Date parser supports `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, and
  `D Mon YYYY` (`27 May 2026`). Adapters declare which they accept.

**`vitest.config.ts`** — node environment, css/postcss disabled (Tailwind 4
config would otherwise blow up the test runner), `@/*` alias mirrored from
`tsconfig.json`.

**`csv/pipeline.test.ts` — 19 specs, all passing.**

| Stage | Spec                                                  |
| ----- | ----------------------------------------------------- |
| 1     | Empty file → E003                                     |
| 1     | Header-only file → E003                               |
| 2     | Missing required column → E010                        |
| 2     | Headers matched case-insensitively + whitespace-trim  |
| 2     | Unknown column → W002 warning, file still accepted    |
| 2     | Duplicate header → E012                               |
| 3     | Unregistered creative → E020                          |
| 3     | Empty creative name → E021                            |
| 3     | Invalid date → E030                                   |
| 3     | ISO + MM/DD/YYYY accepted, normalized to YYYY-MM-DD   |
| 3     | Far-future date → E031                                |
| 3     | Non-numeric spend → E040                              |
| 3     | Negative spend → E041                                 |
| 3     | `"$1,234.56"` parses to 1234.56                       |
| 4     | Same (creative, date) twice → E050 with both row #s   |
| 5     | findExistingBatch returns id → E051 with id           |
| 5     | E050 takes precedence over E051 on the same tuple     |
| H     | Two clean rows → ok: true, both parsed                |
| H     | Subtotal row with empty creative+date silently skipped |

**Quirks worth recording.**
- The Stage-4 dedup key uses an SOH (`\x01`) delimiter as an internal
  separator that can't appear inside a creative name or date. Cosmetic but
  intentional.
- `papaparse.parse(...).errors` doesn't fail the whole file on column-count
  mismatches; Stage 2 schema validation catches the real shape issues.

**Not done.** Route handlers (`POST /api/uploads/validate`,
`POST /api/uploads/commit`), the KV stash for the validate→commit handoff
(local Docker setup has no Redis — will probably back this with a small
`upload_validation_sessions` Postgres table when we get there), the
upload form UI (dropzone, platform select, summary, error report), the
rollback endpoint, the `/uploads` history page.

---

## 2026-05-27 — Validate + commit route handlers (no UI yet)

The validate→commit two-step is fully wired through to the database. A
real CSV can be uploaded over `curl`, parsed through the pipeline, stashed
with a 10-minute token, and committed into `performance_records`. UI is
the next slice; this one stops at the API contract.

**Schema migration `0001_upload_validation_sessions.sql`.** New table:

```sql
CREATE TABLE upload_validation_sessions (
  token                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform             varchar(16) NOT NULL,
  file_name            varchar(255) NOT NULL,
  uploaded_by_user_id  uuid NOT NULL REFERENCES users(id),
  payload              jsonb NOT NULL,        -- ParsedRow[] + summary + warnings
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL
);
CREATE INDEX uvs_expires_idx ON upload_validation_sessions (expires_at);
```

This replaces the Vercel KV stash from tech-spec §7 for now. Same API
shape (insert a token, look it up, delete it) so swapping to KV later is
a 20-line change. TTL is enforced lazily — every `commit` does a quick
`DELETE … WHERE expires_at < now()` before its own lookup.

**`POST /api/uploads/validate`.**
- `requireEditor()` → 401 on auth failure.
- Reads `multipart/form-data` with `file` and `platform`. Validates
  `platform` with Zod against `platformEnum`. Rejects non-File `file` or
  oversized files (>10 MB) at the route level before the pipeline runs.
- Snapshots the registered creative-name set in one query.
- Builds a `findExistingBatch(name, plat, date)` closure that queries
  `performance_records` joined with `creatives` and `upload_batches`,
  filtered to `status = 'active'` so rolled-back batches don't trigger
  false E051 conflicts.
- Runs the pipeline.
- **On errors (422):** returns `{ ok: false, errors, warnings }`. No token,
  no DB write.
- **On success (200):** computes `summary = { rows, creatives, dateRange }`,
  inserts a session row with `expires_at = now() + 10 min`, returns
  `{ ok: true, token, summary, warnings }`.

**`POST /api/uploads/commit`.**
- `requireEditor()` → 401.
- Zod-validates `{ token: uuid }`.
- Lazy expired-sweep, then looks up the session. Absent → 410 with
  `"Token not found or expired"`. Present-but-expired → delete + 410.
- Re-resolves creative IDs by name (in case the registry shifted between
  validate and commit). Any name that vanished → 422 with `missing[]`.
- **One Postgres transaction** does: insert `upload_batches`, bulk insert
  `performance_records` in 500-row chunks via `INSERT … RETURNING`,
  delete the session row.
- Wraps the post-commit `revalidatePath('/' | '/creatives' | '/uploads')`
  in try/catch so revalidation failures don't mask a successful commit.

**E2E curl roundtrip** against the running dev server:

```
3-row CSV (2026-04-15 / 2026-04-16, two creatives)
  → POST /validate         → 200 { token, summary: { rows:3, creatives:2 } }
  → /?from=...&to=...      → "—" (no data)
  → POST /commit { token } → 200 { batchId, rowsImported: 3 }
  → /?from=...&to=...      → "$425.50"     (= 150 + 200 + 75.50, exact match)
```

Failure-path matrix:

| Input                              | Expected codes  | Got            |
| ---------------------------------- | --------------- | -------------- |
| Unknown creative name              | E020            | E020 ✓         |
| Missing required column            | E010            | E010 ✓         |
| Re-upload of the same dates        | E051 × 3        | E051 × 3 ✓     |
| Random / expired token to /commit  | HTTP 410        | HTTP 410 ✓     |

Reverted via `DELETE FROM performance_records WHERE upload_batch_id = '…'`
and the matching `upload_batches` row, since the rollback UI doesn't exist
yet.

**Quirks worth recording.**
- `findExistingBatch` filters by `upload_batches.status = 'active'`. Once
  we ship the rollback endpoint, rolling back a batch will set its status
  to `rolled_back` and re-uploads of those dates will pass E051.
- The pipeline returns `ParsedRow[]` where `spend` and `conversionValue`
  are JS numbers, but the schema stores them as `numeric`. The commit
  handler stringifies them when inserting so postgres-js doesn't lose
  precision through the float64 boundary.
- The route uses `request.formData()` — Next 15's native multipart parser.
  No `formidable` / `multer` needed.

**Not done.** The upload form UI (`/uploads/new`) — dropzone, platform
select, validation result display, summary + confirm step. The `/uploads`
batch-history page. The `DELETE /api/uploads/:batchId` rollback endpoint
(admin-only, within 24h). A periodic sweep for stale validation sessions
(today's lazy-at-commit cleanup is fine for now).

---

## 2026-05-27 — Upload UI (`/uploads/new`) + history (`/uploads`)

The team can now upload a CSV without `curl`. The two API endpoints from
the previous slice power a client-side state-machine form that ends at a
clean success screen, and a sibling history page lists every committed
batch.

**Two shadcn primitives added: `Select`, `Alert`.** Native `<select>` on
the dark theme looked bad; the shadcn version composes with the rest of
the form chrome.

**`components/upload/` set.**
- `dropzone.tsx` — `react-dropzone` wrapper (the dep was already
  installed). CSV-only `accept`, `multiple: false`, `maxSize` mirrors
  `MAX_FILE_BYTES` from `csv/parse.ts`. Shows the file name + size when
  selected with a "Remove" button; otherwise an idle drag target that
  lights up on drag-over. Inline error if the file exceeds the limit or
  the type is wrong.
- `error-report.tsx` — clean list of the validation errors and warnings.
  Each entry shows the stable error code (E020 / E040 / W002 …) in a
  monospace chip and the spec-templated message. The list itself caps at
  `max-h-96` with vertical scroll; will swap for a virtualized list
  (`tanstack/react-virtual`) once we see real files with thousands of
  errors. Footer points to `docs/validation-spec.md` §7.
- `summary-card.tsx` — three stats (rows / creatives / date range) when
  validation succeeds, plus a collapsible warnings strip for non-blocking
  W001 / W002.
- `upload-form.tsx` — the state machine that owns the page. States:
  `idle → validating → invalid | valid → committing → committed | error`.
  Each transition rendered as its own panel; the dropzone + platform
  select disable during in-flight requests. After a successful commit,
  the page replaces itself with a confirmation card (✓ icon, row count,
  batch UUID, "View on Overview" and "Upload another" CTAs) and calls
  `router.refresh()` so the Overview / Library / Uploads pages reflect
  the new data on the next navigation.

**`app/(dashboard)/uploads/new/page.tsx`** — server component that just
renders `<UploadForm />` inside a 3xl container with the page title and a
back-link to the history page.

**`app/(dashboard)/uploads/page.tsx`** — server component listing every
`upload_batches` row joined with the uploader's name, ordered newest
first, capped at 50. Empty-state pitch when there are no batches yet.
`export const dynamic = "force-dynamic"` so the list reflects committed
batches without stale prerender. Sidebar's "Uploads" link no longer 404s.

**Verified E2E in the browser path.**
- Posted a 1-row CSV to `/api/uploads/validate` via the form's `fetch`
  call → received summary + token.
- Confirmed via the "Confirm import" button → received `batchId` +
  `rowsImported`.
- `/uploads` rendered the new batch with the right filename (`up.csv`),
  uploader (Salam), platform (meta), row count (1), and active status.
- Cleaned up the test batch by deleting from `performance_records` and
  `upload_batches` (rollback UI is a follow-up).

**Bundle.** `/uploads/new` ships at 36.4 kB / 177 kB (the dropzone +
state-machine glue). `/uploads` at 309 B / 177 kB (server-rendered table,
no client bundle of its own).

**Not done.** `DELETE /api/uploads/:batchId` rollback endpoint
(admin-only, within 24 h) + a per-row rollback action on `/uploads`.
Real Auth.js v5. `/creatives/new` create form. Compare /
By-Platform pages. CSV export. Real per-platform header maps from
actual exports.

---

## 2026-05-27 — v1 surface complete (push to the finish line)

One long autonomous push closed every remaining v1 surface except the
two items that need external input (real Google OAuth credentials, real
CSV exports for the per-platform header maps). Eight slices landed in
sequence; this entry summarizes each because they all share the patterns
established earlier.

### Slice 1 — Upload rollback (admin, ≤ 24 h)

- `app/actions/rollback.ts::rollbackBatch(batchId)` — `requireAdmin()`,
  refuses outside the 24-hour window or on already-rolled-back batches.
  One transaction: `DELETE FROM performance_records WHERE upload_batch_id
  = …` and `UPDATE upload_batches SET status='rolled_back', rolled_back_at,
  rolled_back_by_user_id`. The validate endpoint's `findExistingBatch`
  already filters by `status='active'`, so re-uploading the same dates
  passes E051 after rollback. Revalidates `/`, `/creatives`, `/uploads`.
- `components/upload/rollback-button.tsx` — destructive-action Dialog
  with the row-count + filename in the body. Confirms before firing.
  Visible per row on `/uploads` only when the current user is admin,
  status is `active`, and the batch is within 24 h.

### Slice 2 — `/creatives/new` create form

- `app/actions/creative.ts::createCreative` — `requireEditor()`, parses
  through the existing `creativeCreateSchema`, pre-checks name uniqueness
  for a clean error message, inserts the creative, then inserts tag rows
  in a second statement. Returns `{ ok, name, fieldErrors? }` so the
  client can map per-field errors. Also exports `updateCreativeNotes`
  for the editable notes panel (slice 7).
- `components/creative/creative-create-form.tsx` — client form with
  name + product (select) + type (select) + status (select) + launch
  date (`<input type="date">`) + comma-separated tags + notes textarea.
  Server Action via `useTransition` so submit is non-blocking. On
  success, `router.push` to the new creative's detail page.
- `app/(dashboard)/creatives/new/page.tsx` — server component, loads
  the product list and renders the form. The "New creative" CTA in the
  library header no longer 404s.

### Slice 3 — `/admin/products` CRUD

- `app/actions/product.ts` — `createProduct`, `archiveProduct`,
  `restoreProduct`, plus `countCreativesPerProduct()`. Admin-only.
  Slug is `slugify(name)` with collision suffixes (`-2`, `-3` …).
  Archived products stay attached to their creatives (PRD §5.2).
- `components/product/{product-create-form, product-row-actions}.tsx`.
- `app/(dashboard)/admin/products/page.tsx` — `requireAdmin()` at the
  top so non-admins get a thrown error. Two tables: Active and
  Archived. Each row shows name / slug / creative count / created
  date / row actions.

### Slice 4 — `/admin/users` role management

- `app/actions/user.ts::inviteUser`, `updateUserRole`. Invite is a
  stub (creates the user row in the DB; the real Auth.js flow will
  reconcile on first Google sign-in). Self-demotion is rejected.
- `components/user/{user-invite-form, user-role-select}.tsx`.
- `app/(dashboard)/admin/users/page.tsx` — `requireAdmin()`, invite
  form at the top, team table with inline role `<Select>` per row.

### Slice 5 — `/compare` page

- `db/queries/performance.ts::compareSeries(filters, metric)` —
  per-creative time series for any of ten metrics (`spend`,
  `impressions`, `clicks`, `conversions`, `ctr`, `cpm`, `cpc`, `cpa`,
  `roas`, `hookRate`). Reuses `buildBaseConditions` so global filters
  still apply.
- `compareTotals(filters)` — per-creative all-time KPIs joined with
  product names for the comparison table.
- `components/charts/compare-chart.tsx` — Recharts `LineChart`, one
  `<Line>` per selected creative, color from a shared 5-color palette
  (`COMPARE_COLORS`), custom tooltip pivoting by date and formatting
  per metric.
- `components/creative/compare-controls.tsx` — client component owning
  URL state for `creativeIds` (csv, capped at 5) and `metric`. Picker
  + selected chips + metric dropdown.
- `app/(dashboard)/compare/page.tsx` — parses searchParams, fetches
  in parallel, renders chart + comparison table. The picker disables
  options once 5 are selected.

### Slice 6 — `/platforms` index + `/platforms/[platform]`

- `app/(dashboard)/platforms/page.tsx` — four-card index linking to
  the four platform pages.
- `app/(dashboard)/platforms/[platform]/page.tsx` — reuses every
  Overview query with `platforms=[platform]` forced. Swaps Blended
  ROAS for Hook Rate on video-heavy platforms (Meta, TikTok). 404 on
  unknown platform slugs. `Platform mix` donut becomes a "Slice" (a
  donut over a single platform is admittedly a circle — still useful
  with empty platforms going to zero).

### Slice 7 — CSV export

- `lib/csv-export.ts` — tiny RFC-4180 writer + `Blob`/anchor
  download. UTF-8 BOM prefix so Excel opens it correctly. Column
  getters receive `(row, index)` so rank/serial columns work.
- `components/ui/download-csv-button.tsx` — reusable trigger.
- Wired onto Top Creatives (Overview + per-platform), the Library
  table view, and the Creative Detail records table. Each export
  uses the rows currently rendered, so URL filters carry through to
  the file.

### Slice 8 — Editable notes + loading skeletons

- `components/creative/notes-panel.tsx` — read mode shows the notes
  with an Edit button; edit mode is a textarea with live char count
  (cap 5000) and Save/Cancel. Calls `updateCreativeNotes` Server
  Action.
- Wired into Creative Detail above the records table.
- A full creative edit form for the remaining fields
  (product/status/type/launchDate/tags) is **deferred** — notes is
  the most-edited field, and other fields can be changed at creation
  time. Edit form is a small follow-up if needed.
- `components/ui/skeleton.tsx` from shadcn.
- Per-route `loading.tsx` files mirror the final layout for `/`,
  `/creatives`, `/creatives/[name]`, `/uploads`. No more flash of
  blank `<main>` while the Server Component is fetching.

### Build / test status

- `npm run build` → clean, 14 routes.
- `npx tsc --noEmit` → clean.
- `npm test` → 19 vitest specs passing.

| Route                          | Static / Dynamic | First Load JS |
| ------------------------------ | ---------------- | ------------- |
| `/`                            | Dynamic          | 300 kB        |
| `/admin/products`              | Dynamic          | 113 kB        |
| `/admin/users`                 | Dynamic          | 142 kB        |
| `/compare`                     | Dynamic          | 247 kB        |
| `/creatives`                   | Dynamic          | 219 kB        |
| `/creatives/[name]`            | Dynamic          | 302 kB        |
| `/creatives/new`               | Static           | 146 kB        |
| `/platforms`                   | Static           | 106 kB        |
| `/platforms/[platform]`        | Dynamic          | 296 kB        |
| `/uploads`                     | Dynamic          | 189 kB        |
| `/uploads/new`                 | Static           | 178 kB        |

### Where this leaves us

What's intentionally **deferred** (each marked elsewhere too):

1. **Real Auth.js v5 (Google + domain restriction)** — needs Google
   OAuth client credentials from the team. Internals-only swap; the
   public `auth()`/`requireAdmin()`/`requireEditor()` shape is stable.
2. **Real per-platform CSV header maps** — needs real Ads-Manager /
   TikTok / Snapchat / Google exports. Today's `csv/platforms/*.ts`
   use plausible placeholder headers.
3. **Full creative edit form** (`/creatives/[name]/edit`) — notes is
   editable from the detail page; product/status/type/launchDate/tags
   are not yet editable from the UI.
4. **pg_trgm + GIN on `creatives.name`** — only matters past ~10k
   creatives or p95 > 100 ms.
5. **Periodic sweep for stale `upload_validation_sessions`** — current
   lazy-at-commit cleanup is sufficient.
6. **Windows-1256 fallback + iconv-lite** — non-UTF-8 currently
   rejected with E004; W001 path TBD.

Everything else from PRD v1 is shipped.

---

## 2026-05-27 — Open-by-email auth + DB-backed CSV column mapping

Two team requests landed: drop the Google-OAuth gate in favor of "any
user that's been added gets in", and let admins tune CSV column maps
from inside the app instead of having to edit `csv/platforms/*.ts`.

### Open-by-email auth

**Security trade-off recorded in code and here.** There is no password
and no Google verification — anyone who knows a teammate's email can
impersonate them. PRD §3 says SSO; this is a deliberate v1 simplification
for an internal trusted-team tool. If the dashboard ever leaves the
office network, layer HTTP basic auth or restore OAuth on top. The
public `auth()` / `requireAuth()` shape stays so the swap is internal.

**Pieces:**

- `lib/auth-cookie.ts` — HMAC-SHA256 signed cookie helpers
  (`setSessionCookie`, `clearSessionCookie`, `readSessionUserId`,
  `verifySessionToken`). Cookie name `ccms_session`, value
  `<userId>.<base64url(hmac)>`, 30-day TTL, `httpOnly`, `sameSite=lax`,
  `secure` in production.
- `lib/auth.ts` rewritten: `auth()` reads the cookie, looks up the user
  in the DB, returns `SessionUser | null`. Wrapped in `cache()` so
  multiple components on the same request share one round-trip.
  `requireAuth/requireAdmin/requireEditor` throw on unauthenticated /
  insufficient role — callers (Server Actions, route handlers) catch
  and return 401/403.
- `AUTH_SECRET` filled in `.env.local` with a 32-byte random string.
- `app/actions/session.ts` — `signIn(formData)` looks up the email
  (case-insensitive), sets the cookie. `signOut()` clears the cookie
  and redirects. No password check.
- `app/(auth)/layout.tsx` + `app/(auth)/signin/page.tsx` — sign-in
  page. If already signed in, redirects to `?next=` or `/`.
- `components/auth/signin-form.tsx` — email input, Server Action via
  `useTransition`. Clear "ask an admin to invite you" message on
  unknown email.
- `components/auth/user-menu.tsx` — avatar dropdown in the top bar
  with name / email / role / Sign-out.
- `(dashboard)/layout.tsx` — calls `await auth()` at the top, redirects
  to `/signin` if null. This is the auth gate; everything under
  `(dashboard)/` is protected. **Edge-runtime middleware was tried
  first and dropped** — `node:crypto` and `next/headers` don't play
  cleanly on Edge, and a server-component layout gate is simpler and
  fast enough. API routes (`/api/uploads/*`) call `requireEditor()`
  internally so they 401 on unauthenticated callers.
- `components/layout/top-bar.tsx` receives the `SessionUser` and
  renders the user menu. Sidebar receives the role and hides the
  Admin section for non-admins.

**Verified end-to-end:**

| Test                                          | Result          |
| --------------------------------------------- | --------------- |
| Unauthenticated `GET /`                       | 307 → /signin  |
| `GET /signin`                                 | 200, form rendered |
| Signed cookie → `GET /`                       | 200             |
| Signed cookie → `GET /admin/platforms`        | 200             |
| Tampered cookie → `GET /`                     | 307 → /signin  |
| Unauthenticated `POST /api/uploads/validate`  | 401             |

### DB-backed platform CSV column mapping

Replaces the hard-coded `headerMap` blocks in `csv/platforms/*.ts` with
a `platform_field_mappings` table that admins edit from
`/admin/platforms`. The hard-coded adapters still ship the
`requiredFields`, `acceptedDateFormats`, and `skipRow` rule; only the
header-candidate list moves to the DB.

**Migration `0002_platform_field_mappings.sql`:** new table with a
unique index on `(platform, internal_field, header_name)` and a
platform-scoped lookup index.

**Seed extended.** On every `npm run db:seed`, the placeholder values
currently in `csv/platforms/*.ts` are backfilled into the new table.
Idempotent via the unique-index `ON CONFLICT DO NOTHING`. Result on a
fresh seed: 70 mappings inserted across 4 platforms × ~17 fields ×
candidates.

**`db/queries/platforms.ts`:**

- `listAllMappings()` / `listMappingsForPlatform(platform)` — read.
- `resolveAdapter(platform)` — merges DB rows over the code-level
  adapter so missing fields still fall back to the hard-coded
  defaults. Returns a full `PlatformAdapter` shape.

**Pipeline refactor.** `runPipeline()` now accepts either an `adapter`
(resolved-on-the-fly with DB data) or a `platform` (uses the static
`ADAPTERS` map — handy for tests). The validate route calls
`await resolveAdapter(platform)` before `runPipeline`. All 19
existing vitest specs still pass without modification.

**`app/actions/platform-mapping.ts`:**

- `addHeaderMapping({ platform, internalField, headerName })` —
  admin-only, appends at the end of the priority list for the
  (platform, field). Unique constraint protects against duplicates.
- `removeHeaderMapping(id)` — admin-only.

**`/admin/platforms` page.** Per platform: quick-add form (field
dropdown + header text input + Add) then a table with one row per
internal field, listing every header candidate as a chip with an
inline ✕ to remove it. Empty rows for required fields show a warning
that uploads will fail with E010 until a candidate exists.

**Verified end-to-end (authenticated curl roundtrip):**

| Step                                | Result                                              |
| ----------------------------------- | --------------------------------------------------- |
| `GET /admin/platforms`              | 200; CSV column mapping page with Meta section      |
| 1-row Meta CSV → `/validate`        | 200; token, summary `{ rows:1, creatives:1 }`       |
| `/commit { token }`                 | 200; `batchId` + `rowsImported:1`                   |
| Pipeline uses DB-resolved adapter   | ✓                                                   |

### Sidebar gets a CSV-mapping link

The admin nav grew a "CSV mapping" entry pointing to `/admin/platforms`.
Visible only to admins.

### Status

`npm run typecheck` ✓ · `npm run build` ✓ (16 routes) · `npm test` ✓ (19 specs).

**Still deferred** (no external input needed but not done):
- Full creative edit form (`/creatives/[name]/edit`) for fields other
  than notes.
- `pg_trgm` GIN index on `creatives.name` (only matters past ~10k creatives).
- Periodic sweep of stale `upload_validation_sessions`.
- Windows-1256 fallback (`iconv-lite`) for the W001 warning path.
- Production deployment (Vercel + Neon + Vercel Blob).

When a real upload's header isn't recognized, the flow is now:
1. Upload fails with `E010 Required column missing: <name>`.
2. Open `/admin/platforms`.
3. Add the actual header from your CSV under the right internal field.
4. Re-upload — no code change needed.

---

## 2026-05-27 — Email + password auth (bcrypt)

Replaced the email-only sign-in with proper email + password using
**bcryptjs** at cost 12. The HMAC-cookie session model is unchanged;
only the gate at `/signin` got stricter.

**Schema migration `0003_user_password_hash.sql`** — adds nullable
`users.password_hash text`. Nullable so the migration is safe on
existing rows; sign-in rejects rows without a hash with a clear
message ("Ask an admin to set one for you").

**`lib/auth-password.ts`** wraps `bcryptjs.hash/compare`. Cost factor
12. Enforces `PASSWORD_MIN_LENGTH = 8`, `PASSWORD_MAX_LENGTH = 128`.

**Server Actions in `app/actions/session.ts`:**
- `signIn({ email, password })` — Zod-validate, look the email up
  case-insensitively, `bcrypt.compare`. Generic "Wrong email or
  password" on both missing-email and wrong-password cases so we
  don't leak which emails exist.
- `changePassword({ currentPassword, newPassword, confirmPassword })`
  — verifies the current password before writing a new hash, with
  matching-confirmation enforced via a Zod refinement.

**Server Actions in `app/actions/user.ts`:**
- `inviteUser({ name, email, role, password })` — admin only. Now
  requires a starter password (min 8 chars). The admin shares it
  with the teammate out-of-band and they change it on first sign-in.
- `adminSetPassword({ userId, password })` — admin only. Resets any
  user's password.

**UI:**
- `components/auth/signin-form.tsx` — added password input with
  `autoComplete="current-password"`.
- `components/auth/change-password-dialog.tsx` — current / new /
  confirm fields, success message, opens from the user menu.
- `components/auth/user-menu.tsx` — "Change password" item above
  Sign out.
- `components/user/user-invite-form.tsx` — starter password input
  next to the role select.
- `components/user/admin-set-password-button.tsx` — per-row button
  in `/admin/users` for password reset.

**Seed updated.** The admin row is now created (or repaired) with a
bcrypt hash of the dev-only password on every `npm run db:seed`.
Re-running the seed will reset a forgotten admin password without
dropping the user row.

**Dev credentials:**

```
email:    salam@urjwan.com
password: urjwan-dev-2026
```

Change it from the user menu → Change password the first time you
sign in. The seed reset behavior also means you can recover by
re-running `npm run db:seed`.

**Security trade-off (still recorded).** This is plaintext password
auth — no email verification, no second factor, no rate-limiting.
Suitable for an internal trusted-team tool on a local network.
Before exposing the dashboard publicly:
- Rate-limit `signIn` (lock after N failures).
- Add password-reset over email.
- Optional: 2FA for admins.

**Verified:**
- `bcrypt.compare(right, hash)` → `true`.
- `bcrypt.compare(wrong, hash)` → `false`.
- `bcrypt.compare("", hash)` → `false`.
- `GET /` while unauthenticated → 307 → `/signin`.
- `/signin` renders both email and password fields.
- Type-check + build clean (16 routes).
- All 19 vitest specs still pass.

---

## 2026-05-27 — Upload UX improvements (4 of them)

Direct response to the team's first-test feedback. Four targeted changes
to make the upload less brittle and less click-heavy.

### 1. Accept `.xlsx` (and `.xls`) in addition to CSV

SheetJS (the `xlsx` package) reads workbooks. `csv/parse.ts` was renamed
internally to `parseFile()` (the `parseCsv` export is preserved as an
alias) and now routes by extension + magic-byte sniffing (`PK\x03\x04`):
- `.xlsx` / `.xls` / xlsx magic → `XLSX.read` + `sheet_to_json({ header: 1 })`
  to produce the same `string[][]` shape as the CSV path.
- Anything else → existing papaparse path.

The Dropzone's `accept` map grew the relevant MIME types; copy and the
"file too large / wrong type" inline errors say "CSV or XLSX up to 10 MB".

The route handler doesn't care — `parseFile` is the unified entrypoint.

### 2. Auto-detect the platform from the file's headers

The old form required picking a platform up-front; a wrong pick fired
E010 cascades. Now:

- `csv/platforms/detect.ts::detectPlatform(headers, adapters)` scores
  each platform by how many of its internal-field candidate headers
  appear in the file. Returns the best platform plus whether the top
  score was tied (`ambiguous`).
- `POST /api/uploads/validate` makes the `platform` form field optional.
  When omitted, the route auto-detects from the parsed header row. The
  response now includes a `detection` block:
  `{ used: "auto" | "explicit", platform, ambiguous, scores }`.
- The Upload form drops the platform select from the default state.
  After validate, a small banner shows "Detected platform: Meta · auto"
  (or "your override" if you set one). Wrong? An expandable "Override"
  control lets you pick from the four and re-validate.

If no platform scores at all (file's headers don't match any adapter's
mapping), the response is a clean error pointing at /admin/platforms.

### 3. Permissive date parser

Previously each adapter accepted only `YYYY-MM-DD` and `MM/DD/YYYY` (Meta
also took `D Mon YYYY`). Real exports from the team use `DD/MM/YYYY`. The
parser now:

- Accepts `/`, `-`, and `.` as separators for the day/month/year forms.
- Tries `DD/MM/YYYY` before `MM/DD/YYYY` so day-first wins on ambiguity.
- ISO `YYYY-MM-DD` (and `YYYY/MM/DD`, `YYYY.MM.DD`) stays unambiguous.

So `28/05/2026`, `28-05-2026`, `28.05.2026`, `2026-05-28`, and
`28 May 2026` (Meta only) all parse to the canonical `2026-05-28`. For
truly ambiguous strings (`05/04/2026`), DD/MM/YYYY wins — matches the
regional convention. The Meta adapter's `D Mon YYYY` is still supported.

### 4. All mapped columns required

The user's feedback was "all of them or the file is not accepted".
Each adapter's `requiredFields` now lists every internal field
(creative_name, date, spend, impressions, clicks, conversions,
conversion_value, video_views_3s, video_views_15s). Files missing any
of those headers fire E010 per missing column.

**Important caveat in the pipeline.** "All columns required" is enforced
at the *header* level, not at the *cell* level. A real-world row will
sometimes have a blank `conversions` cell (zero conversions on the day);
that's normal data, not an error. The pipeline now:

- Treats every numeric field's blank cell as `0` (the previous
  `parseRequired` distinction for spend/impressions/clicks is gone).
- Still surfaces `E040` for non-numeric strings and `E041` for negatives.
- `creative_name` and `date` cells still must be non-empty (E021/E042),
  because zero doesn't make sense for those.

This matches what the team actually wants: "your file must have all the
columns, but a day with no conversions is still a valid day".

### Tests

25 vitest specs now (was 19). New coverage:
- All-columns-required: dropping `Impressions` or `Purchase value` → E010.
- Blank cells in optional-looking metrics → parsed as 0, not E042.
- Dash and dot separators for DD/MM/YYYY.
- DD/MM/YYYY wins ambiguity over MM/DD/YYYY.
- `detectPlatform()` picks Meta on a Meta-shaped file, returns null on
  unrecognized headers, and reports ambiguity when scores tie.

### End-to-end browser-path checks

Authenticated curl roundtrip:

| File                                  | Detection           | Result                                  |
| ------------------------------------- | ------------------- | --------------------------------------- |
| Meta-shaped CSV w/ `28/02/2026`       | `meta` (9/9)        | ok; 2 rows; date `2026-02-28`           |
| TikTok-shaped CSV, no override        | `tiktok` (9/9)      | ok; auto-detected correctly             |
| 5-column "old-shape" Meta CSV         | `meta`              | 4× E010 (the missing fields)            |
| Meta-shaped XLSX (built via SheetJS)  | `meta`              | ok; 2 rows; DD/MM dates parsed          |

Build + typecheck clean. 16 routes unchanged.

### Not changed

- `platform` form field is still accepted when explicitly passed —
  override path is fully functional.
- `csv/platforms/*.ts` still hold the *fallback* defaults that get
  seeded into `platform_field_mappings` and merged on read via
  `resolveAdapter()`. Admin edits in `/admin/platforms` win.
- `requiredFields` is still hard-coded in the adapter files. If the team
  wants to make a field truly optional for one platform (e.g. Snapchat
  rarely exports `video_views_15s`), the next iteration is to add a
  `required` boolean column on `platform_field_mappings` and toggle from
  the admin UI. Skipped for now — current strict mode matches the
  request.

---

## 2026-05-27 — Drop auto-detect, force explicit platform pick

Team feedback: auto-detect is too magical; an explicit picker is safer.
Reverted the auto-detect path and replaced with a manual two-step form.

**Validate route is strict again.** `platform` form field is required;
missing or invalid → HTTP 400 with `"Pick a platform before validating
(meta / tiktok / snapchat / google)."`. Response no longer carries a
`detection` block — just `{ ok, token, platform, summary, warnings }`.

**`csv/platforms/detect.ts` deleted.** Its three vitest specs were
removed at the same time. Test suite is back down to 22 specs (was 25),
all passing.

**`components/upload/platform-picker.tsx` added.** Four buttons in a
2×2 grid with the platform's color dot, the name, and a check-mark when
selected. `role="radiogroup"` with `role="radio"` per button for
accessibility. **No default selection.** Disabled state follows the
form's `busy` flag.

**`upload-form.tsx` flow:**
1. Drop file. The dropzone enforces size (≤10 MB) and extension
   (CSV/XLS/XLSX) on the spot.
2. When a file is staged, a numbered "2. Platform" section appears
   below it with the picker. Until a platform is picked, the inline
   hint reads "Pick the platform that exported this file. Required."
3. The **Validate** button is disabled until both file *and* platform
   are set.
4. Server runs the pipeline against the chosen platform. Errors show
   without trying to second-guess the platform; rerunning the same
   validation simply re-uses the picked platform.

**Verified browser path:**

| Request                                | Response                                       |
| -------------------------------------- | ---------------------------------------------- |
| Validate with no platform              | HTTP 400, clear "Pick a platform" message      |
| Validate with `platform=meta`          | HTTP 200, `{ ok:true, platform:"meta", … }`    |
| `GET /uploads/new` HTML                | Dropzone visible, "1. File" / "2. Platform" labels, no auto-detect copy remaining |

Build clean (16 routes). Tests 22/22.
