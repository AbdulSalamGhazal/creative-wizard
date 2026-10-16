# Rules census

> Every rule in CLAUDE.md and in `docs/decisions/*` walked once and
> classified: enforced by a test, promoted to one in this change, or prose
> with the reason it cannot be a test. Generated for the 2026-10 census and
> maintained by hand — **a new rule belongs in this table the day it is
> written**, because a rule nobody can check is a rule that decays.

## Where it stands

| | rules | share |
|---|---:|---:|
| enforced | 133 | 72% |
| guard added | 8 | 4% |
| prose | 43 | 23% |
| **total** | **184** | |

141 of 184 rules (77%) are checked by something that runs.

The five guards written for this census, each demonstrated to BITE by
introducing the violation and watching it fail:

| guard | holds |
|---|---|
| `app/routes.test.ts` | every route ships `loading.tsx` + sets metadata (redirect stubs detected by shape) |
| `db/exclusion-writers.test.ts` | `excluded_from_aggregates` has exactly two writers |
| `lib/browser-storage.test.ts` | per-browser storage stays a short, argued allowlist |
| `components/data-access.test.ts` | components don't reach past the query layer |
| `lib/dependency-shape.test.ts` | the one added dependency stays pinned, single-importer, lazy |

## CLAUDE.md

### Source documents

| rule | status | evidence / why not |
|---|---|---|
| Consult prd / validation-spec / tech-spec before a non-trivial decision | prose | a reading habit; no artifact to assert |
| A rule conflicting with a doc is FLAGGED, not silently resolved | prose | judgment; the flag is a message, not a file |
| Before changing a domain, read its decisions file | prose | reading can't be observed — but `docs/decisions-map.test.ts` keeps the files findable |

### Stack

| rule | status | evidence / why not |
|---|---|---|
| Next App Router + TS strict | enforced | `npm run typecheck` (tsconfig strict:true) |
| Drizzle + Postgres; never prisma/sequelize | enforced | `tests/db/**` runs the real schema through drizzle |
| Auth is HMAC cookie + bcrypt, NOT Auth.js | enforced | `lib/auth-cookie.test.ts`, `lib/session-edge.test.ts` |
| @xyflow/react exact-pinned, ONE importer, lazy | **guard added** | NEW `lib/dependency-shape.test.ts` — pin + single importer + dynamic import |
| Vercel Blob for thumbnails; KV unused | prose | infrastructure fact, not code shape |
| No new dependency without a justification line | prose | the justification lives in a PR description |
| Vercel env vars are exactly DATABASE_URL / AUTH_SECRET / BLOB token | prose | deployment config, outside the repo |

### Code conventions

| rule | status | evidence / why not |
|---|---|---|
| strict: true; never `any` | enforced | `npm run typecheck`; eslint `@typescript-eslint/no-explicit-any` |
| Server Components by default; 'use client' only when needed | prose | a judgment per file |
| kebab-case files, PascalCase components, UPPER_SNAKE constants | prose | convention; a linter rule would be noisy on legitimate exceptions |
| Data fetching lives in db/queries/*, not inline in pages | **guard added** | NEW `app/routes.test.ts` sibling check is partial — see census note |
| All inputs validated through Zod in validators/ | enforced | `validators/*.test.ts` (5 files) pin the schemas; actions call them |
| No raw SQL except db/queries/performance.ts | prose | **STALE — see findings.** 16 files use `sql``; the rule as written is false |

### Database rules

| rule | status | evidence / why not |
|---|---|---|
| Schema changes go through migrations; never edit a generated one | prose | a process rule about files we don't regenerate |
| Every filtered/joined/sorted column has an index | prose | requires a query plan, not a grep |
| performance_records unique on (creative, platform, campaign, date) | enforced | `tests/db/performance.test.ts` + the unique index itself |
| Exactly four sanctioned exit paths from performance_records | enforced | `tests/db/cleanup.test.ts`, `tests/db/creatives.test.ts` (deletion summaries) |
| Every creative has a product_id | enforced | `validators/creative.test.ts` + NOT NULL + `tests/db/creative-patch.test.ts` |

### Aggregation rules

| rule | status | evidence / why not |
|---|---|---|
| Weighted averages via component sums, never AVG(ratio) | enforced | `lib/metrics.test.ts`, `lib/funnel-totals.test.ts`, `tests/db/summary.test.ts` |
| Derived-metric SQL only from lib/metrics.ts | prose | a grep would false-positive on every legitimate fragment |
| NULLIF on every divisor so undefined renders — | enforced | `lib/metrics.test.ts`, `lib/format.test.ts` (dash means NULL) |
| excluded_from_aggregates filtered by default; TWO writers only | **guard added** | NEW `db/exclusion-writers.test.ts`; filtering pinned by `tests/db/*` |

### Validation rules

| rule | status | evidence / why not |
|---|---|---|
| 5 stages, order fixed; 1–2 fail fast, 3–5 collect | enforced | `csv/pipeline.test.ts` |
| trim-then-exact matching, blanks read as 0 | enforced | `csv/pipeline.test.ts`, `csv/cross-platform.test.ts` |
| All-or-nothing commit | enforced | `tests/db/fractional-counts.test.ts` (a bad row imports nothing) |
| CSV or XLSX through ONE conversion layer | enforced | `csv/xlsx.test.ts` |
| Counts round at normalization and raise W004 | enforced | `csv/pipeline.test.ts`, `tests/db/fractional-counts.test.ts` |
| COUNT_FIELDS derives from FIELD_META.kind | enforced | `csv/pipeline.test.ts` derivation assertions |
| Every error comes from a catalog (E / S codes) | enforced | `csv/pipeline.test.ts`, `store/pipeline.test.ts` |

### UI rules

| rule | status | evidence / why not |
|---|---|---|
| Every page has tailored skeletons | **guard added** | NEW `app/routes.test.ts` — loading.tsx per route, stubs exempt |
| Use shadcn primitives; don't reinvent | prose | judgment; the primitives list is prose |
| Every route sets metadata.title | **guard added** | NEW `app/routes.test.ts` |
| Tabular figures on every number in tables | prose | a class on a cell; a grep would be noise |
| USD via Intl en-US currency | enforced | `lib/format.test.ts` |
| ISO dates in tables, friendly in tooltips | enforced | `lib/format.test.ts` (isoDate/monthDay) |

### Never

| rule | status | evidence / why not |
|---|---|---|
| Never write perf records without a parent batch | enforced | FK + `tests/db/performance.test.ts` |
| Never bypass validation / no force-import | prose | the absence of a feature can't be tested for |
| Never AVG(ratio) | enforced | `lib/metrics.test.ts` |
| Never bypass the excluded filter without the toggle | enforced | `tests/db/*` aggregate tests |
| Never save a creative without product_id | enforced | `validators/creative.test.ts` + NOT NULL |
| Never store secrets in code or client bundles | prose | a secret scanner is a different tool |
| Never modify an uploaded CSV on disk | prose | we never write to the upload; nothing to assert |
| Never use `any` | enforced | typecheck + eslint |
| Never run prisma/sequelize | prose | those packages are not installed |

### Workflow

| rule | status | evidence / why not |
|---|---|---|
| Small reviewable changes, one feature per session | prose | process |
| A test alongside any non-trivial logic | prose | judgment — though the guards here are the habit in action |
| Judgment calls are REPORTED, never silent | prose | a property of the report, not the repo |
| A rig check verifies the COMPOSED SURFACE | prose | process; the fonts half is now a stated precondition |
| The rig must use the real fonts | prose | the rig lives in a scratchpad, outside the repo |
| A server page's imports verified against a REAL Next render | enforced | `app/rsc-boundary.test.ts` pins the import rule itself |
| Two test suites; test:db needs docker | enforced | `vitest.config.db.ts` globalSetup fails loudly without it |
| Docs ship in the same commit as the change | prose | a property of the commit, not the tree |

### Deployment

| rule | status | evidence / why not |
|---|---|---|
| main is shippable; push auto-deploys | prose | an external pipeline |
| Health check at /api/health | enforced | `tests/db/edge-gaps.test.ts` touches the route's query path |
| Pooled URL in Vercel, direct only for migrations | prose | environment configuration |
| Migrations do NOT run on deploy — run them by hand | prose | an operational step |
| Never db:seed against prod | prose | an operational prohibition |
| Changing the cookie format invalidates every login | enforced | `lib/auth-cookie.test.ts` pins the format |

### Traps

| rule | status | evidence / why not |
|---|---|---|
| next build fails on unescaped entities; never trust `build | tail` | enforced | `npm run build` in the gate set, with the grep |
| Prevent enum drift — DERIVE, don't re-list | enforced | `lib/palette.test.ts`, `validators/summary.test.ts`, `lib/funnel-stages.test.ts` |
| The invisible U+0001 separator (csv/pipeline, db/queries/funnel) | enforced | `csv/pipeline.test.ts` dedup cases exercise the key |
| The direct Neon URL is derived, not stored | prose | an operational step |

## docs/decisions

### `budget.md`

| invariant | status | evidence / why not |
|---|---|---|
| No exclusion filtering on Budget actuals | enforced | `tests/db/budget.test.ts` (raw totals reconcile) |
| Revenue is a monthly store total; no platform attribution | enforced | `lib/budget.test.ts` (platform filter locks to Spend) |
| ROAS always through accounts.usd_to_sar_rate | enforced | `lib/budget.test.ts` roasThroughRate |
| Every plan-to-date number goes through buildPlanSeries | enforced | `lib/budget.test.ts` pins curve months BIT-IDENTICAL |
| One plan mode at a time, pinned by savePlanSchema.source | enforced | `validators/budget.test.ts`, `tests/db/budget.test.ts` |
| replaceBudgetMonth is the ONE writer; daily allocations derived | enforced | `tests/db/budget-revisions.test.ts` |
| Every plan write appends a revision in the same transaction | enforced | `tests/db/budget-revisions.test.ts` |
| Pacing compares against coverage, not the calendar | enforced | `lib/budget.test.ts` makeCoverageDay cases |
| Reserve is part of the total and outside the curve | enforced | `lib/budget.test.ts` reserve helpers |
| Save blocked below 100% | enforced | `lib/budget.test.ts` sharesComplete |
| Audience: carry forward, unknown ≠ 0, pressure on known days | enforced | `lib/audience.test.ts`, `tests/db/audience.test.ts` |

### `campaigns.md`

| invariant | status | evidence / why not |
|---|---|---|
| A perf row's campaign is a FK; names from campaigns.name | enforced | `tests/db/portfolio.test.ts` |
| Name format only through buildCampaignName() | enforced | `lib/campaign.test.ts` |
| Duplicates keyed (creative, platform, campaign_id, date) → E050/E051 | enforced | `csv/pipeline.test.ts` |
| Objective vocabulary is CAMPAIGN_OBJECTIVES; retired values never return | enforced | `lib/campaign.test.ts` |
| Deleting a campaign keeps its creatives | enforced | `tests/db/cleanup.test.ts` |

### `canvas.md`

| invariant | status | evidence / why not |
|---|---|---|
| Read-only: nothing edited, no position saved | prose | the absence of a feature |
| TWO CLOCKS — range = existence, window = liveness | enforced | `tests/db/canvas.test.ts` |
| ONE scan; statuses from cached inputs | enforced | `tests/db/status-cache.test.ts` counts round-trips |
| Node totals are true range spend; filters only hide | enforced | `tests/db/canvas.test.ts` |
| @xyflow has one importer, lazily loaded | **guard added** | NEW `lib/dependency-shape.test.ts` |
| The legend is non-optional; a cap that bites says so | prose | a rendering judgment |
| Nodes carry `measured`; the initial fit is by hand | prose | a React Flow interaction, not a pure rule |

### `comments-notifications.md`

| invariant | status | evidence / why not |
|---|---|---|
| Producers write inside the describing transaction | enforced | `tests/db/notifications.test.ts` |
| Self-scoped on every read and write | enforced | `tests/db/notifications.test.ts` |
| Silent by default; actor excluded | enforced | `tests/db/notifications.test.ts` |
| Archive, never delete | enforced | `tests/db/notifications.test.ts` |
| Individual notifications are not audited | enforced | `tests/db/notifications.test.ts` |
| categoryForType is the one derivation | enforced | `lib/notifications.test.ts` |
| One row per person per comment, by priority | enforced | `lib/comments.test.ts` splitCommentRecipients |
| Mentions explicit from the picker; non-member refused | enforced | `tests/db/comments.test.ts` |
| Threads are flat | enforced | `tests/db/comments.test.ts` |
| Soft delete; restore only by the deleter, via the audit row | enforced | `tests/db/comments.test.ts` |
| comment-markdown escapes FIRST, then transforms | enforced | `lib/comment-markdown.test.ts` |
| First load never toasts; reactions notify the author only | enforced | `lib/notifications.test.ts`, `tests/db/comments.test.ts` |

### `creative-status.md`

| invariant | status | evidence / why not |
|---|---|---|
| Status is derived, never stored | enforced | `lib/creative-status.test.ts`, `tests/db/status.test.ts` |
| Each platform anchors to its own latest spend day | enforced | `tests/db/status.test.ts` |
| Campaign status: 2-state, no override, no schema | enforced | `lib/campaign-status.test.ts` |
| Status maps from the cached brandStatusInputs() | enforced | `tests/db/status-cache.test.ts` (round-trip count) |
| Terminated is manual, sticky, per creative×platform | enforced | `tests/db/status.test.ts` |
| The Library strip is a facet counted before the status filter | enforced | `lib/creative-status.test.ts` statusBreakdownOf |

### `creatives.md`

| invariant | status | evidence / why not |
|---|---|---|
| Every creative has a product_id | enforced | `validators/creative.test.ts` + NOT NULL |
| Inline editing; no /edit route; patchCreative never touches notes | enforced | `tests/db/creative-patch.test.ts` |
| Priority ≠ Rate; unrated sorts last both ways | enforced | `lib/priority.test.ts` |
| Stage has three states; N/A exclusive; never widen FUNNEL_STAGES | enforced | `lib/funnel-stages.test.ts`, `validators/creative.test.ts` |
| Stage is never auto-derived | prose | the absence of an inference |
| Deleting a creative removes its records first, in a transaction | enforced | `tests/db/creatives.test.ts` |
| The concept is an angle, never a tag | enforced | `tests/db/angles.test.ts` + the schema |

### `exclusions.md`

| invariant | status | evidence / why not |
|---|---|---|
| Exactly TWO writers | **guard added** | NEW `db/exclusion-writers.test.ts` |
| Applying skips already-excluded rows | enforced | `tests/db/exclusion-rules.test.ts` |
| Un-applying re-sweeps the survivors | enforced | `tests/db/exclusion-rules.test.ts` |
| Manual un-exclude refuses a rule-excluded row | enforced | `tests/db/exclusion-rules.test.ts` |
| Objective edits release stale stamps in the same transaction | enforced | `tests/db/exclusion-rules.test.ts` |

### `filters.md`

| invariant | status | evidence / why not |
|---|---|---|
| Never hand-roll a filter bar | enforced | `components/filters/migrated-bars.test.ts` |
| Adding a filter is ONE FilterDef, zero shell edits | enforced | `components/filters/filter-model.test.ts` |
| Clear clears tier-2 filters and nothing else | enforced | `filter-model.test.ts` + `validators/summary.test.ts` |
| A view switch / the Excluded toggle are not filters | enforced | `filter-model.test.ts` |
| Ranges and filters resolve server-side from RAW params | enforced | `tests/db/filter-prefs.test.ts` |
| URL → preference → default, with sv and fx suppressions | enforced | `tests/db/filter-prefs.test.ts` |
| A cleared filter deletes its row | enforced | `tests/db/filter-prefs.test.ts` |
| useFilterParams is the only URL writer; writes compose | enforced | `migrated-bars.test.ts`, `lib/url.test.ts` |
| Every def key has an icon | enforced | `components/filters/filter-icons.test.ts` |

### `google-platforms.md`

| invariant | status | evidence / why not |
|---|---|---|
| Google is ordinary except in data shape | enforced | `csv/google.test.ts` |
| The unavailable set is declared once | enforced | `csv/google.test.ts` |
| NULL ≠ 0 | enforced | `tests/db/google.test.ts` |
| Ratios exclude non-reporting platforms from BOTH sides | enforced | `lib/metrics.test.ts`, `tests/db/google.test.ts` |
| PLATFORMS_WITH_CREATIVES scopes the comparison surfaces | enforced | `lib/palette.test.ts` |
| funnel-totals is the JS mirror; sums stay nullable to the UI | enforced | `lib/funnel-totals.test.ts` |

### `mcp-diagnosis.md`

| invariant | status | evidence / why not |
|---|---|---|
| The MCP server is read-only | enforced | `tests/db/mcp.test.ts` |
| Tools via the registered pattern, reusing db/queries | prose | a code-shape convention the review catches |
| Cookieless tenancy validates the account | enforced | `lib/tenant-context.test.ts`, `tests/db/mcp.test.ts` |
| OAuth: exact redirect, PKCE S256, single-use codes, rotation | enforced | `lib/oauth.test.ts`, `tests/db/oauth.test.ts` |
| Diagnosis never calls an AI, holds a key, or writes | prose | the absence of a capability |
| The interview / artifact / self-commitment sentences | enforced | `lib/diagnosis.test.ts` (string-pinned) |
| The bundle preserves NULLs and reports caps | enforced | `lib/diagnosis.test.ts` |

### `schema-migrations.md`

| invariant | status | evidence / why not |
|---|---|---|
| Never edit a generated migration | prose | a process rule about files we don't regenerate |
| pgEnum is a varchar — vocabulary changes need no migration | enforced | `tests/db/**` run the real migrations |
| NOT NULL on a populated table needs a default or backfill | prose | a migration-authoring rule |
| A hand-written migration is never regenerated | prose | process |

### `store.md`

| invariant | status | evidence / why not |
|---|---|---|
| Store uploads never touch the ads pipeline | enforced | `store/pipeline.test.ts` |
| Currency is SAR, module-local | enforced | `lib/format.test.ts` (sar), `tests/db/store.test.ts` |
| 3 core + 2 system-required fields; rest in attributes | enforced | `validators/store.test.ts`, `tests/db/store.test.ts` |
| Upsert PATCHES attributes | enforced | `tests/db/store.test.ts` |
| Sanctioned deletes only; orders paginated | enforced | `tests/db/store-cleanup.test.ts` |
| Insights: store facts only, two scans, blank is a bucket | enforced | `tests/db/store-insights.test.ts` |
| Reconciliation: counts only, Δ = claimed − store | enforced | `lib/reconciliation.test.ts` |
| Totals from range sums, never averaged per-day | enforced | `store/channels.test.ts`, `tests/db/reconciliation.test.ts` |
| The two lenses bucket exactly as Reconciliation does | enforced | `tests/db/store-insights.test.ts` |

### `tables-columns.md`

| invariant | status | evidence / why not |
|---|---|---|
| Every DataTable passes a columnsKey | enforced | `components/ui/table-columns-coverage.test.ts` |
| The control lives in the header row | enforced | `table-columns-coverage.test.ts` (TableCorner) |
| defaultHidden absence = HIDDEN; opt-in stored as !key | enforced | `lib/table-columns.test.ts` |
| Precedence: URL → view → preference → config | enforced | `lib/table-columns.test.ts`, `components/portfolio/portfolio-columns.test.ts` |
| Reset deletes the row; an awaited write before navigation | enforced | `tests/db/table-prefs.test.ts`, `lib/table-prefs.test.ts` |
| A table offers what its query carries, defaultHidden | enforced | `table-columns-coverage.test.ts` catalog block |
| A pinned column must fit the frame | prose | a rendered width; measured in the rig, not assertable headlessly |
| A grouped header is the only licence to leave DataTable | enforced | `table-columns-coverage.test.ts` exemptions |
| The wrapper may own the sort (composite / nulls / CSV order) | enforced | `launch-fatigue.test.ts`, `campaign-funnel-table.test.ts`, `creative-records-table.test.ts` |
| URL-backed tables are out of the catalog rule's scope | enforced | `portfolio-columns.test.ts` |

### `tenancy-auth.md`

| invariant | status | evidence / why not |
|---|---|---|
| Every tenant read injects account_id; writes stamp it | enforced | `tests/db/security.test.ts` |
| Membership says WHERE, permissions say WHAT | enforced | `lib/account-access.test.ts`, `tests/db/user-accounts.test.ts` |
| Re-validate a caller-supplied FK against the account | enforced | `tests/db/security.test.ts` |
| Angle cascades bounded by a creatives-in-account subquery | enforced | `tests/db/angles.test.ts` |
| Zero brands throws NO_BRAND_ACCESS | enforced | `lib/account-access.test.ts` |
| Permissions derive from the catalog; the server is the gate | enforced | `lib/permissions.test.ts`, `lib/auth.test.ts` |
| The commit uses the account pinned at validate time | enforced | `tests/db/security.test.ts` |

### `ui-system.md`

| invariant | status | evidence / why not |
|---|---|---|
| Four themes on one axis; data colours are vars | prose | CSS; a token audit is a different tool |
| One UI font, no switcher | prose | the absence of a feature |
| Every route: PageShell, loading.tsx, metadata.title, 375px | **guard added** | NEW `app/routes.test.ts` (two of the four) |
| Use the shared primitives; extend, don't fork | prose | judgment |
| Route changes go through useNavTransition | prose | a hook choice; a grep would miss indirection |
| Nav is one source (nav-items.ts) | enforced | `components/layout/nav-items.test.ts` |
| Empty states designed; dash means NULL | enforced | `lib/format.test.ts` (dash) — the design half is prose |

### `uploads-csv.md`

| invariant | status | evidence / why not |
|---|---|---|
| Five stages, order fixed, all-or-nothing | enforced | `csv/pipeline.test.ts` |
| Trim-then-exact; blanks are 0 | enforced | `csv/pipeline.test.ts` |
| One conversion layer for CSV/XLSX | enforced | `csv/xlsx.test.ts` |
| Counts round at normalization; W004 | enforced | `tests/db/fractional-counts.test.ts` |
| A new field means all five places; the UI derives | enforced | `csv/cross-platform.test.ts` |
| Upsert reuses import validation; updates aren't rollback-able | enforced | `tests/db/performance.test.ts` |
| Four sanctioned exits from performance_records | enforced | `tests/db/cleanup.test.ts` |

## Findings — rules that reality disagrees with

Walking the rules turned up three places where the written rule and the
code have drifted. None is fixed here: each is a decision, not a typo.

1. **"No raw SQL except `db/queries/performance.ts`" is false as written.**
   Sixteen files use a `sql` template, including most of `db/queries/*`,
   `lib/metrics.ts` (by design — it IS the fragment library) and three
   outside the query layer: `app/actions/audience.ts`, `app/actions/session.ts`,
   `app/api/health/route.ts`. Either the rule should say "inside the query
   layer and `lib/metrics.ts`", or those three callers should move. Left as
   prose until someone decides which.
2. **A component queries the database inline.**
   `components/product/products-admin.tsx` imports `db` + drizzle + the
   schema and runs its own query, against the Code-conventions rule. It is
   recorded in `components/data-access.test.ts` as a KNOWN VIOLATION rather
   than an exemption — the list may shrink, not grow.
3. **One column-state key still lives in `localStorage`.**
   `components/summary/summary-table.tsx` persists its drag-resized identity
   column widths per browser. The Ads table is a grouped twin that never
   moved onto `DataTable`, so the ephemeral-width rule never reached it.
   Allowed in `lib/browser-storage.test.ts` with that said out loud.

## Not enforceable, and why that is fine

The prose column is not a backlog. Most of it is one of four kinds:

- **The absence of a feature** (no force-import, no AI call in diagnosis, no
  font switcher). You cannot test that something was never built.
- **A judgment** (use the primitives, extend don't fork, small commits).
  A test would either pass trivially or fight legitimate exceptions.
- **An operational step** outside the repo (migrations are run by hand, the
  direct Neon URL is derived, env vars).
- **A rendered property** (a pinned column fits the frame, tabular figures).
  Measured in the rig against real CSS; a headless assertion would be
  measuring the wrong thing — see the Times-font trap.

*Generated 2026-10-16 · 184 rules.*
