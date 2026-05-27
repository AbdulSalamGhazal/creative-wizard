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
