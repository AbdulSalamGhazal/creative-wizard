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
- Auth: custom HMAC-signed cookie sessions (`lib/auth-cookie.ts`) + bcrypt passwords (`lib/auth-password.ts`). Users created via `/admin/users`; first admin via `db/create-admin.ts`. NOT Auth.js/Google — those were never wired up. **Authorization is GRANULAR per-user permissions** (`lib/permissions.ts` catalog is the single source of truth) — see `docs/decisions/tenancy-auth.md`. Admins bypass every check; below admin, each capability is individually grantable and managed on the unified **Team** page (`/admin/users`).
- Tailwind + shadcn/ui + shadcn charts (Recharts under the hood)
- papaparse (CSV), Zod (validation)
- **`@xyflow/react` (React Flow), EXACT-pinned `12.11.6`** — the one dependency added in months, user-approved. Justification: *purpose-built node canvas (pan/zoom/minimap/focus) for the Canvas page; hand-rolling it is weeks of work.* It is imported by ONE module (`components/canvas/canvas-flow.tsx`) and loaded with `next/dynamic` (`ssr: false`), so it ships as a lazy chunk on `/canvas` only — see `docs/decisions/canvas.md`.
- Vercel hosting. Vercel KV is NOT used (upload-validation sessions live in Postgres). **Vercel Blob IS used** for creative thumbnails: uploaded via `POST /api/uploads/thumbnail` (requires `creative.edit`; client downscales→WebP first), stored public, and the returned URL is saved to `creatives.thumbnail_url`. **Profile photos** (2026-10-20) use the same store via `POST /api/uploads/avatar` (yours: signed in; anyone's: `users.manage`) → `users.avatar_url`; with no token in LOCAL dev they fall back to gitignored `public/dev-uploads/avatars/`. Requires `BLOB_READ_WRITE_TOKEN` (auto-added when a Blob store is connected to the project); the blob host is allow-listed in `next.config.ts` `images.remotePatterns`.

Do not introduce a new dependency without a one-line justification in the PR description.

## Code conventions

- `tsconfig.json` is `strict: true`. Never use `any`. Prefer `unknown` and narrow.
- Server Components by default. Add `"use client"` only when you need interactivity, browser APIs, or React hooks.
- Files: kebab-case. Components: PascalCase. Functions and variables: camelCase. Constants: UPPER_SNAKE.
- Each route's page renders one composed view; data fetching lives in `db/queries/*`, not inline in pages.
- All inputs (route handler bodies, form data, URL params used as filters) are validated through Zod schemas in `validators/`.
- Raw `sql` templates live in the QUERY LAYER (`db/queries/*`) and in
  `lib/metrics.ts`, the fragment library — plus five named sites that each
  carry their reason in `db/raw-sql.test.ts` (schema defaults, the seed,
  OAuth's atomic single-use `UPDATE`, the audience upsert's `excluded.*`, the
  sign-in `LOWER(email)`, the health probe's `select 1`). **No component, page
  or validator may use raw SQL** — that is the half that matters, because a
  query written outside the layer skips the account scoping the layer applies
  for everybody. (The old rule named one file while sixteen used `sql`; a rule
  that is simply false teaches people to skim the section it lives in.)

## Database rules

- Schema changes go through Drizzle migrations. Never edit a generated migration; create a new one.
- Every column used in a filter, join, or sort needs an index. Declare it in the schema file alongside the column.
- When adding a new dashboard query, check whether existing indexes cover it; add one if not.
- `performance_records` is **unique** on `(creative_id, platform, campaign_id, date, landing_page_id)` **NULLS NOT DISTINCT** (constraint `perf_identity_uq`) — the same creative can run on the same platform/date across different campaigns, or to different landing pages in one campaign (distinct rows), but not the same campaign + landing page twice; NULL `landing_page_id` = the product's own page. (`campaign_id` is the FK to the campaigns registry; the old `campaign_name` text column is gone — see `docs/decisions/campaigns.md`. `landing_page_id` comes from an ad name's ` @code` — see `docs/decisions/uploads-csv.md`.) Validation is still the only **entry** path. There are four sanctioned **exit** paths (each gated by a granular permission — see `docs/decisions/tenancy-auth.md`; admins always pass): (1) batch rollback within 24 h (`upload.rollback`), (2) the record-cleanup tool on `/uploads` (filtered hard-delete, `upload.cleanup`, preview-then-confirm, audit-logged via `upload.bulk_delete`), (3) deleting a creative (`deleteCreative` in `app/actions/creative.ts`) — which removes that creative's records inside a transaction because `performance_records.creative_id` has NO `ON DELETE CASCADE`, then deletes the creative (its `creative_angles` cascade). `creative.delete`, confirm-with-record-summary, audit-logged via `creative.delete`, and (4) deleting a campaign (`deleteCampaign` in `app/actions/campaign.ts`) — the campaign detail page's danger zone; because `performance_records.campaign_id` also has NO `ON DELETE CASCADE`, it removes the campaign's records inside a transaction, then drops the `campaigns` row. The CREATIVES that ran in the campaign are KEPT (only their records for that campaign go); confirm-with-record-summary (`campaignDeletionSummary`), `campaign.delete`, audit-logged via `campaign.delete`. No other code should delete from `performance_records`.
- Every creative has a required `product_id`. Products live in their own table and are managed on the Library's **Products** tab (`/library?tab=products`). Never let a creative be saved without one.

## Aggregation rules (CRITICAL)

- Every blended or aggregated metric is computed as a **weighted average via component sums** — never as a mean of per-row ratios. `SUM(clicks) / NULLIF(SUM(impressions), 0)`, never `AVG(clicks::numeric / impressions)`.
- All derived-metric SQL fragments are imported from `lib/metrics.ts`. Do not open-code them in `db/queries/*`. If the formula needs to change, change it in `lib/metrics.ts` and every dashboard updates.
- Use `NULLIF(divisor, 0)` so undefined values render as `NULL` → `—` in the UI, not as `0` or `Infinity`.
- All aggregation queries apply `WHERE excluded_from_aggregates = false` by default. The shared Excluded toggle (`?includeExcluded=1|0`) flips this per page — the toggle sits on EVERY aggregate surface, and its state is a saved per-user preference (`users.include_excluded`; resolution: explicit URL param → saved pref → hidden, via `resolveIncludeExcluded`). Detail pages always show every record with an "Excluded" badge. **The flag itself has exactly TWO sanctioned writers:** the manual per-record action (`excluded_source='manual'`) and the exclusion-rules engine (`'rule'` + `excluded_rule_id`) — nothing else may flip it.

## Validation rules (from validation-spec.md)

- The CSV pipeline is 5 stages. Do not reorder them.
- Stages 1–2 fail fast. Stages 3–5 collect errors.
- Creative-name matching is **trim-then-exact** — cells are whitespace-trimmed, then matched byte-exactly (case-sensitive, NO Unicode normalization). An ad name may end in ` @code` (one space, `@`, a registered landing page's code): the cell is split at the first ` @` by `lib/landing-code.ts` — the creative matches on the part before it, the code matches the landing-page registry exactly (E022 malformed, E023 unregistered), and a code that changed on a live ad is refused (E052). Creative names may never contain ` @`. Blank/`-`/`—`/`N/A`/`null` numeric cells read as `0` in every numeric column; a required numeric field errors only when its COLUMN is absent (E010), never per blank cell. (v1.2 decision — see validation-spec §4/§5.1.)
- All-or-nothing: nothing is written to `performance_records` unless the entire file is clean and the user confirms.
- **CSV *or* XLSX everywhere, through ONE conversion layer (2026-10).** All four upload surfaces (ads uploads, store order uploads, the Budget plan sheet, the bulk creative import) take `.csv`, `.xlsx`, `.xlsm`, `.xls`; `csv/parse.ts` routes by extension OR `PK\x03\x04` magic bytes and converts the FIRST worksheet to the same rows of strings papaparse yields — dates → ISO UTC (`YYYY-MM-DD`), numbers → plain decimals (never `1e+21`), formulas → cached values, booleans → `TRUE`/`FALSE`, blanks → `""`. **Nothing downstream may branch on the format**; validators see strings either way. A multi-sheet workbook reads the first sheet and SAYS SO (W003 → S061 in the store catalog), surfaced wherever warnings already are. Unreadable files split three ways on purpose: password-protected (its own sentence), corrupt/partial (`.xlsx` re-save), and non-spreadsheet binary (E002 "This doesn't look like a CSV or Excel file", decided by a NUL byte in the first 4 KB — never E004 "encoding"). **The workbook reader is SheetJS (`xlsx`), already a dependency — do NOT add a second one** (`exceljs` was proposed and declined), and it never reaches a client bundle: the 4 MB limit the dropzone needs lives in the dependency-free `csv/limits.ts` (W2-6). The Budget plan sheet parses CSV in the browser and posts a WORKBOOK to `readSheetRows` (`app/actions/sheet.ts`, read-only server action) so /budget/plan's bundle stays free of a spreadsheet reader; `csv/xlsx.test.ts` builds its workbooks in-test with `XLSX.write` rather than committing binary fixtures.
- **COUNT metrics round to the NEAREST whole number at normalization, and say so (2026-10).** The eleven count columns in `performance_records` are `integer` (user decision), and Google's data-driven attribution reports fractional conversions — an unrounded `11.5` made Postgres reject the ENTIRE commit (22P02), so a 400-row file imported nothing. Rounding happens in the pipeline's normalization, never at insert, so the preview, the summary totals and the stored rows state the same number; each affected field raises **W004** naming how many cells changed, and a whole-number file says nothing. **Which fields are counts is declared ONCE in `FIELD_META.kind` and derived as `COUNT_FIELDS`** — never hand-list it at a consumer; a hand-listed set is how `conversions` missed the coercion its ten siblings had. Money stays `numeric(14,4)` and keeps every decimal.
- Every error has a code from a catalog — now TWO of them: `csv/errors.ts` (E-codes, ads performance uploads) and `store/errors.ts` (S-codes, Store order uploads). Never invent ad-hoc error messages; pick the catalog for the domain.

## UI rules

- The dashboard must feel polished. Every page has tailored skeletons. Empty states are designed-out, not blank.
- Use shadcn primitives. Don't reinvent components that exist.
- Every new route sets a `metadata.title` (matching its sidebar/h1 label); detail routes use `generateMetadata` over a `cache()`-deduped query so the tab title and the page share one fetch. The root layout's `%s · Wizard` template adds the suffix — don't repeat it, and never add a `metadata.icons` key (the tab icon is the `app/icon.png` file convention).
- **ONE render per action (2026-10).** An action that revalidates already
  re-renders the caller's page in its response: a caller that stays never
  `router.refresh()`es after it; a caller that navigates away (create, delete,
  rename) calls an action that doesn't revalidate. Never send a write that is
  still pending when its own navigation starts (Next then refreshes again).
- **Every client call to a server action goes through `safeAction` +
  `toastActionFailure`** — a row toasts, a form shows it inline, a stale tab
  gets Reload, and an editor keeps its input. Both rules are pinned by
  `app/actions/action-calls.test.ts`. → `docs/decisions/ui-system.md`
- Tabular figures (`font-variant-numeric: tabular-nums`) on every number in tables.
- USD formatting: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.
- Dates: ISO format in tables, friendlier formats in chart tooltips and headers.
- **Show, don't label (2026-10-19, user rule).** When a sign, a colour or a
  position already says it, the word is noise: a pacing verdict is
  "−$1,844 (−61%)" in the behind colour, never "▼ behind $1,844"; a section's
  purpose is its title, not a sentence under it; a unit is printed once; a
  helper sentence that genuinely matters becomes an ⓘ tooltip (`InfoTip`, the
  house popover + title pattern, keyboard-reachable), not body copy.
  Accessibility keeps every word — `aria-label`, `title` or `sr-only` text say
  "ahead", "behind", "projected". The test: if the visual conveys it in under
  a second, the text is noise. → `docs/decisions/ux-standards.md`

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
- **TWO CLASSES OF AMBIGUITY, and only one of them is yours to settle.**
  A brief cannot specify everything, so ambiguity is expected; what must not
  happen is resolving the wrong kind of it alone.
  - **Convention-level** — which hook, how the code is structured, naming,
    file layout, anything the user cannot see. **Decide it, and REPORT it** in
    the Judgment calls section: what was chosen and why, one line each. "None"
    is a valid entry; an unstated judgment call is not, because a reviewer
    reading the logic has no way to know a choice was ever made.
  - **Requirement-shaping** — anything the user could look at and say "that
    is not what I meant": where new UI goes or whether it appears at all,
    scope boundaries, wording they will read, what data is offered or hidden,
    any behaviour beyond the brief's letter. **STOP and ask.** Send the
    options with a recommendation instead of building a guess. A round-trip
    costs a message; a guess that reaches production costs the feature's
    credibility, and we have paid that.
  - **The test is one question: could the user see this and object?** If yes,
    it is requirement-shaping, however small it looks from inside the code.
    Being unsure is itself an answer — ask.
- **Every feature report ends with a UX REVIEW.** Walk the checklist in
  `docs/decisions/ux-standards.md` and state each line pass / fail / n-a —
  honestly, which means a fail is either FIXED before reporting or raised as a
  decision, never quietly marked n-a. It covers consistency with the house
  patterns, feedback on every action, every state designed, no dead ends,
  discoverability, copy, economy, and the phone. It is about the QUALITY of
  the experience, not colour or theming — the palette is settled.
- **A UI rig check verifies the COMPOSED SURFACE, not the component.** The rig
  pass shows the whole unit the change lands in — the full comment row, the
  full toolbar, the full card — with ALL its siblings, in EVERY state the
  change adds (including the empty one), at desktop and 375px. "The widget
  renders" is not a pass: reaction pills shipped wedged between a message and
  its own Reply button because the rig showed the pills alone, and every
  checkpoint after that read logic rather than JSX order.
  **AND THE RIG MUST USE THE REAL FONTS.** The app's font vars are
  Next-generated and do not resolve outside it, so an esbuild rig silently
  renders in TIMES — every width measured in one is then measured in the wrong
  font, and Times is narrower than Plus Jakarta Sans, so a layout defect reads
  as SMALLER than it is (this hid a 298px pinned cell inside a 291px frame).
  Point `--font-ui` / `--font-mono` / `--font-display` at the webfonts the rig
  already loads before trusting a single pixel, and check
  `getComputedStyle(el).fontFamily` once per rig. A measurement governed by a
  `max-width` is font-independent and can be trusted either way.
  **A change to a SERVER page's imports or data flow is verified against a REAL
  Next render of that route** — signed in, in a browser — not against the rig
  and not against green gates. The rig bundles with esbuild and never renders
  on a server; typecheck, `next build` and both test suites are equally blind
  to the RSC boundary. /campaigns shipped broken because a server page read a
  value out of a `"use client"` module (every export of one is a
  client-reference proxy on the server, so touching it throws at request time).
  The rule that prevents it: **a server component may import a client
  COMPONENT, never a VALUE from a client module** — shared data goes in a plain
  module both sides import, and `app/rsc-boundary.test.ts` now fails the build
  if that line is crossed.
  **WALK THE FEATURE, NOT THE COMPONENTS.** Before reporting, traverse the
  finished work AS THE USER: the full click path end to end, across every
  surface it touched, in every state (empty · one · many · long values ·
  error), at desktop and 375px. The composed-surface pass proves a UNIT; the
  walk proves the SEAMS between units, which is where the bugs that shipped
  actually lived — reaction pills wedged against a Reply button, a comment
  drawer's highlight outliving its own post. Report it as its own line:
  **Walked: <path>, states covered: <list>**. A feature you have not walked is
  a feature you are describing, not one you have seen.
  **Know what each check PROVES, because they are not interchangeable.** A
  **307** on a dashboard route proves middleware and routing are intact and
  NOTHING about the page: a page with a deliberately broken import still
  returns 307, because the redirect happens before the page module is ever
  loaded (measured 2026-10, after a session's worth of reports had quietly
  claimed otherwise). **`next build`** is what proves every page's module
  graph resolves — the same broken import fails it. **Only a signed-in render
  proves the page RENDERS.** Say which one you did; never let the cheap check
  stand in for the expensive one.
- **Two test suites.** `npm test` (or `npx vitest run`) is the pure-unit suite —
  no DB, no docker, always safe in CI. `npm run test:db` is the **real-database**
  suite (`tests/db/**`, config `vitest.config.db.ts`): its globalSetup creates a
  dedicated **`ccms_test`** database on the local docker Postgres and runs the
  Drizzle migrations, then points `DATABASE_URL` at it — and it runs at
  PRODUCTION pool size (`DB_POOL_MAX=1`), so a `db`-inside-`tx` deadlock hangs
  a test instead of shipping. It NEVER touches `ccms`
  (dev) or prod. The default suite excludes `tests/db/**`, so a machine without
  docker still runs green. DB tests `vi.mock("@/lib/tenant")` to drive the active
  account (cookies are unavailable in vitest) and re-seed via
  `tests/db/fixtures.ts` `resetAndSeed()`; the fixtures pin the weighted-
  aggregation, `excluded_from_aggregates`, tenancy-isolation, and per-platform
  status-freshness invariants of `db/queries/*`.
- When a change touches one of the documents in `docs/`, update the document in the same change.
- **Before changing a domain, read its file in `docs/decisions/`.** The domain
  map below carries only each domain's sharpest invariants; the file carries
  the full set and the history that produced them. A rule you broke because
  you read only the map is still a rule you broke.
- When the user corrects a mistake that could repeat, write the RULE into the
  owning domain's invariants (or this file's rules sections when it binds every
  change) and the narrative into that domain file's history.

> **Docs are part of the change, not an afterthought.** Any change that alters
> behavior described in `docs/*` or in this file MUST update the affected document
> in the same commit — a PR/session that changes validation, schema identity, auth,
> tenancy, deletion paths, or metrics without a matching doc edit is incomplete.
> When code and a doc disagree, do not silently pick a side: fix the doc or flag
> the conflict. At the end of any session that shipped a feature, re-read the doc
> sections it touches and correct drift. Docs must stay clean, current, and
> non-contradictory — a domain file may add nuance, but this file's rules
> sections must never state something a domain file contradicts.
> **When adding a `pgTable`, update §4's table count in the same commit**
> (`grep -c '= pgTable(' db/schema.ts` is the source of truth) — that heading has
> now gone stale twice.

## Deployment (production) — LIVE

This app is deployed and in production use. Treat `main` as shippable.

- **Host:** Vercel, GitHub-integrated. Remote `origin` = `git@github.com:AbdulSalamGhazal/creative-wizard.git`. **Pushing to `main` auto-deploys** (`next build`); a failed build keeps the previous version serving (zero downtime).
- **URL:** https://creative.urjwan.com (custom domain, Let's Encrypt TLS, auto-renew). The `*.vercel.app` URL also resolves but Google Safe Browsing false-flags the shared domain — always use the custom domain.
- **Health check:** `GET /api/health` (public, no auth) → `200 {status:"ok", commit:"<short sha>"}` when the DB is reachable (`commit` is the git sha Vercel built from — the one-curl answer to "is the latest deploy live?"; null locally), `503 {status:"degraded"}` when not. Point an uptime monitor at it. The DB client (`lib/db.ts`) has `connect_timeout: 10` so an unreachable DB fails fast and surfaces the `(dashboard)/error.tsx` boundary (calmer "temporarily unavailable" copy for connection errors) instead of hanging; route errors `console.error` → visible in Vercel logs.
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


## Traps that have cost us a deploy

These are not domain knowledge — they bite any change, so they live here.

- **`next build` fails on `react/no-unescaped-entities` — `tsc`/typecheck does
  NOT catch it.** A raw apostrophe/quote in JSX *text* (e.g. `that platform's
  day`) is an ESLint **error** that fails `next build` (and therefore the Vercel
  deploy), even though `npm run typecheck` is green. Escape as `&apos;`/`&rsquo;`
  or reword. When verifying a deploy, **never trust `npm run build | tail -n`** —
  the "Failed to compile" line scrolls above the tail window and looks like a
  success. Check the exit code and `grep -iE "failed to compile|Error:"` on the
  full log. A failed Vercel build silently keeps serving the previous deploy, so
  prod looks "not updated" with no error surfaced.

- **Never query `db` inside a `db.transaction` callback — prod's pool is ONE
  connection, so it DEADLOCKS.** `lib/db.ts` is `max: 1` on Vercel: the
  transaction holds the only connection, and a query through the global `db`
  (or a helper that defaults to it) waits for a connection that never frees —
  the request hangs until the function is killed. Locally (`max: 10`) it
  quietly borrows a second connection, so dev never sees it. Pass the `tx` to
  every helper (query helpers take an `exec`/`tx` parameter for exactly this),
  or resolve what you need BEFORE the transaction. The DB suite runs at
  production pool size (`DB_POOL_MAX=1` in `vitest.config.db.ts`, pinned by
  `tests/db/pool.test.ts`), so such a query hangs its test — but that suite
  MOCKS `lib/tenant` and `lib/auth`, so `getActiveAccountId()` / `auth()`
  called inside a transaction would still slip past it: call them first.
  (2026-10: every reaction on a creative or campaign comment hung in prod
  this way — `resolveAnchorPath` ran on `db` inside `toggleReaction`'s
  transaction.)
- **Prevent enum drift — DERIVE, don't re-list.** A validator/option list that
  mirrors the platform set or CSV field set must derive from the canonical
  source (`platformEnum`, `INTERNAL_FIELDS`) via spread, not hand-copied
  literals. Two drift bugs shipped in v2 from copied lists: `platform-mapping.ts`
  FIELDS (rejected `campaign_name`) and `validators/summary.ts`
  `METRIC_FILTER_SCOPES` (kept dead `meta`, dropped IG/FB filters). Both now use
  `[...platformEnum]` / `INTERNAL_FIELDS`. **Import those enums from
  `lib/enums`, never `@/db/schema`, in anything a client can reach**: the
  schema can't be tree-shaken, so one enum shipped all 42 tables and their
  names to the browser (W2-6; `app/client-bundle.test.ts` fails the build).
- **csv/pipeline.ts dedup key uses an INVISIBLE U+0001 (SOH) separator.** It does
  NOT render in the Read tool, grep output, or most diffs, so the key-build and
  `k.split(...)` lines LOOK like they have no delimiter — they DO. A review pass
  false-flagged this as a `split("")` bug; it is correct. Confirm with
  `python3 -c '...repr(line)'` before "fixing", and use Python (not the Edit
  tool) to modify those lines — Edit can't match the control char.
  `db/queries/funnel.ts` joined this convention in 2026-10 for the same reason
  and one more: its composite map key used U+0000, and a single NUL byte makes
  **grep treat the whole FILE as binary** — `grep -rn "CampaignFunnelRow" db/`
  returned nothing and every code search silently skipped the file (git diffs
  it as `Bin` too). U+0001 greps normally; U+0000 never again.
- **The direct (non-pooler) Neon URL is derived, not stored.** `.env.production.local`
  holds only the pooled `DATABASE_URL`; for `drizzle-kit migrate` derive the
  direct URL by replacing `-pooler.` with `.` in the host.


## Domain map

Each domain's full invariants and its history live in `docs/decisions/`.
**Before changing a domain, read its file** — the lines here are the sharpest
invariants, not the whole contract, and a rule you break because you only read
this map is still a rule you broke.

### Budget

- Actual spend applies NO exclusion filtering — raw totals, by decision.
- Every plan-to-date number goes through `buildPlanSeries`.
- Pacing compares against DATA COVERAGE, never the calendar.
- `replaceBudgetMonth` is the ONE plan writer; revisions are written in its transaction.
- Revenue has no platform attribution anywhere in Budget.
- Reserve USED = Σ platforms max(0, actual − plan) — platform overshoot, never bucket drift.
- Verdicts are coloured by DIRECTION — ahead `--ahead` (blue), behind `--behind` (the warn
  amber), on track muted; |deviation| vs `PACING_WARN_THRESHOLD` decides strong vs faint.
  Never green/red. One helper, `pacingTone`; tokens only through `lib/palette.ts`.
- Tracker merged into Pacing (2026-10-19); the board is range-based, one math path with the chart.

→ **`docs/decisions/budget.md`**

### Campaigns

- A perf row's campaign is a FK; names come from `campaigns.name`.
- The name format lives only in `buildCampaignName()`.

→ **`docs/decisions/campaigns.md`**

### Canvas

- Read-only facts: nothing is edited, no position is saved.
- TWO CLOCKS: the range decides existence, the status window decides liveness.
- `@xyflow/react` has exactly one importer, lazily loaded.

→ **`docs/decisions/canvas.md`**

### Comments & notifications

- Producers write notifications inside the transaction of the thing they describe.
- Every read and write is scoped to (session user, active brand).
- Silent by default; the actor never hears about their own event.
- `comment-markdown.ts` is the only place user input becomes HTML — escape first, then transform.
- Archive, never delete.
- Comment and notification actions never `revalidatePath` — the panel and the bell live on every page.
- Opening the bell = seen (it lists every unread up to its cap); the panel showing a thread marks that thread's comment notifications read.
- ONE `UserAvatar` (photo → initials) for every person picture — never fork an avatar.
- Notification titles isolate user-supplied names (U+2068/U+2069, `lib/bidi.ts`); comment blocks are `dir="auto"`.

→ **`docs/decisions/comments-notifications.md`**

### Creative & campaign status

- Status is derived from spend, never stored.
- Each platform anchors to its OWN latest spend day.
- Status maps come from the cached `brandStatusInputs()` — never add a status scan.

→ **`docs/decisions/creative-status.md`**

### Creatives, priority, stage and angles

- Every creative has a `product_id`.
- A creative name never contains ` @` — uploads split there for the landing code.
- Priority = manual judgment, Rate = computed performance — never conflate.
- Stage has three states and is never auto-derived; never widen `FUNNEL_STAGES`.
- The concept is an angle, never a tag.

→ **`docs/decisions/creatives.md`**

### Exclusions

- `excluded_from_aggregates` has exactly two writers: manual and rule.
- Un-applying a rule re-sweeps the survivors; manual un-exclude refuses a rule's row.

→ **`docs/decisions/exclusions.md`**

### Filters, ranges and saved views

- Never hand-roll a filter bar — adding a filter is adding ONE `FilterDef`.
- Ranges and filters resolve SERVER-side; pass RAW params, hand resolved values back to the bar.
- Clear clears tier-2 filters and nothing else.
- A view switch and the Excluded toggle are not filters.
- Range and Excluded are write-through; a Back/Forward-restored page catches up once.

→ **`docs/decisions/filters.md`**

### Google and the platform metric set

- NULL ≠ 0: a platform that never measured a field is not one that measured zero.
- A ratio touching an unreported field excludes those platforms from BOTH sides.
- `PLATFORMS_WITH_CREATIVES` scopes the comparison surfaces; funnel excludes google wholesale.

→ **`docs/decisions/google-platforms.md`**

### MCP, OAuth and AI diagnosis

- The MCP server is strictly READ-ONLY — never add a mutating tool.
- Diagnosis assembles and instructs: nothing calls an AI, holds a key, or writes.
- OAuth's non-negotiables are test-pinned; don't relax one to make a client work.

→ **`docs/decisions/mcp-diagnosis.md`**

### Schema and migrations

- Never edit a generated migration.
- `pgEnum` is a varchar — a vocabulary change needs no migration.

→ **`docs/decisions/schema-migrations.md`**

### Store module

- Store uploads never touch `csv/`, `upload_batches` or `performance_records`.
- Currency is SAR, module-local — never convert to USD here.
- Upsert PATCHES `attributes`; an absent column leaves the stored value alone.
- Reconciliation is counts only — no revenue comparison, ever.

→ **`docs/decisions/store.md`**

### Tables and the columns system

- Every `DataTable` passes a `columnsKey`; the control lives in the header row.
- A table offers every field its query already carries, `defaultHidden` — never a new scan.
- A `defaultHidden` column's absence means HIDDEN; its opt-in is stored as `!key`.
- A pinned column must fit the frame (phone cap + `truncate`).
- Precedence: URL → applied saved view → preference → config.

→ **`docs/decisions/tables-columns.md`**

### Tenancy, membership and permissions

- Every tenant read injects `account_id`; every write stamps it.
- Membership says WHERE, permissions say WHAT; the server is the gate.
- Re-validate a caller-supplied FK against the active account before writing.
- Below admin, `users.manage` works within the manager's own access — one guard, `teamGuard`.

→ **`docs/decisions/tenancy-auth.md`**

### The UI system

- Use the shared primitives; extend, never fork.
- Every route: `PageShell`, a tailored `loading.tsx`, a `metadata.title`, 375px.
- Any route/search-param change goes through `useNavTransition`.
- One render per action; every action call through `safeAction`.

→ **`docs/decisions/ui-system.md`**

### The upload pipeline (CSV/XLSX)

- Five stages, in order, all-or-nothing.
- Trim-then-exact matching; blank numerics are 0 — a decision, not a bug.
- ` @code` names a registered landing page; it is part of the record identity,
  and a code can't change on a live ad (E052).
- CSV or XLSX through ONE conversion layer; nothing downstream branches on format.
- Counts round at normalization and say so (W004).

→ **`docs/decisions/uploads-csv.md`**

### UX standards

- Name the house pattern before inventing one; extend, never fork.
- Every action gives feedback; every state is designed; no dead ends.
- A feature nobody can find does not exist.
- Friction scales with irreversibility; the phone is a first-class render.
- **Quality of the experience — NOT colour or theming.**

→ **`docs/decisions/ux-standards.md`**


## Learned

The append-only Learned section was retired on 2026-10 at 2,021 lines: every
session paid ~33K tokens to load history about domains it would not touch, and
the real rules were diluted inside it — the rig-font trap went unwritten for
months while the narratives grew. **Finding a rule, not writing one, was the
failure mode.**

Its content was MOVED, not summarized: every entry now lives in
`docs/decisions/<domain>.md` under that domain's invariants, verbatim.

**When the user corrects a mistake that could repeat:** add the rule to the
owning domain's invariants (and to the domain map above when it is sharp enough
to need no context), or to this file's rules sections when it binds every
change. Append the narrative to that domain file's history — never back here.
