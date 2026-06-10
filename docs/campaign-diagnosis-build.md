# Build Spec — Campaign Diagnosis Page Redesign

> **Hand-off doc for Claude Code.** Goal: rebuild `/campaigns/[campaign]` so its single job is to **diagnose *why* a campaign wins or loses**, not to display its metrics. Audience: internal expert media buyers. Backed by a deep-research pass (10 verified findings) + an audit of every existing page to guarantee zero duplication.
>
> Read `CLAUDE.md` first — all of its rules bind here (weighted aggregation via `lib/metrics.ts`, `excluded_from_aggregates = false` default, tenant scoping via `getActiveAccountId()`, `strict` TS / no `any`, server components by default, shadcn + Recharts, `tabular-nums`, USD via `Intl.NumberFormat`, tailored skeletons + designed empty states, tests alongside `db/queries/*` and `lib/*`, small reviewable PRs).

---

## 0. Context & the "do-not-duplicate" rule

A page audit confirmed these lenses already exist elsewhere — **the campaign page must NOT re-implement any of them**:

| Already owned by | Lens |
|---|---|
| `/funnel` | CPM→CTR→VOC→CvR funnel stages & rates |
| `/trends/over-time` | period-over-period KPI deltas + top movers |
| `/trends/by-type`, `/by-tag`, `/video` | format / tag / video-retention rollups |
| `/summary` | flat per-creative metric roster |
| `/compare` | two-sided A/B line charts |
| `/creatives/[name]` | single-creative deep dive |
| `/` (dashboard) & current `/campaigns` index | efficiency scatter, Pareto, allocation donut, KPI tiles |

The current `/campaigns/[campaign]` detail page (KPI tiles → funnel stages → trend line → platform table → creatives table → records table) is a campaign-flavoured clone of the creative-detail page. **Replace its body** with the 5 diagnostic panels below. Keep the page header/meta and the date-range control; move the raw records table behind a collapsed "Raw data" disclosure.

### 0.1 Blast radius & safety guarantees (verified)
This change is **isolated to the campaign-detail feature**. Verified by usage grep:

- **No other page imports `db/queries/campaign.ts`** — it's consumed only by `/campaigns/[campaign]` and its own components. Changing/extending it cannot affect other pages.
- **The campaigns *index* (`/campaigns/page.tsx`) uses `db/queries/portfolio.ts`, not `campaign.ts`** — leave it untouched.
- **No DB risk:** the only schema change is an *additive index* (§3). It changes no data and no existing column, and only speeds up queries — other pages are unaffected. It is **optional**: the queries already run today without it, so it may be skipped if a migration is unwanted.
- **`lib/metrics.ts`, `lib/period.ts`, `lib/palette.ts`, `lib/format.ts` are READ-ONLY here** — reuse, never modify (they're shared app-wide).

**⚠️ The one trap — shared components. Do NOT delete these (they're also used by `/funnel`):**
| Component | Action |
|---|---|
| `components/funnel/funnel-stages.tsx` (`FunnelStages`) | **Keep the file.** Only remove its *import/usage* from the campaign page. |
| `components/funnel/funnel-trend-chart.tsx` (`FunnelTrendChart`) | **Keep the file.** Only remove its *import/usage* from the campaign page. |

Safe to **delete** (campaign-only, verified no other importer): `components/campaign/campaign-trend-chart.tsx`, `campaign-platform-table.tsx`, `campaign-creatives-table.tsx`. **Keep** `campaign-records-table.tsx` (reused for the raw-data disclosure). **Before deleting any component, re-grep its name across `app/` + `components/` to confirm zero other importers.**

### Data-model note (important)
`performance_records.campaign_name` is the campaign **identity** — it already encodes `"Campaign ➤ Adset"` (with `"(Instagram)"`/`"(Facebook)"` suffix for Meta). So **one `campaign_name` = one campaign+adset on one platform.** The detail page diagnoses **one `campaign_name`**; its internal dimensions are therefore **creatives** (primary) and **days**. A true campaign→adset→creative rollup belongs on the *index* and is **out of scope** here (note it as a future enhancement).

---

## 1. The 5 panels (page composition, in order)

```
<CampaignDiagnosisPage>
  <CampaignHeader>            // keep: name, platform, adset, spend/sales/creatives/days, date filter
  1. <CampaignVerdict>        // Performance Index + bullet vs within-audience expected
  2. <CampaignRoasBridge>     // mix vs rate waterfall (current vs prior period)
  3. <CampaignContribution>   // creatives ranked by net contribution to the change
  4. <CampaignStructure>      // within-campaign winners/losers + money-left-on-the-table
  5. <CampaignRetentionZones> // video-only: retention curve with root-cause zones
  <RawRecordsDisclosure>      // collapsed; reuse existing CampaignRecordsTable
```

Every panel: tailored skeleton, designed empty/insufficient-data state, `tabular-nums` on all figures, USD via `Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})`.

---

## 2. Math specs (put pure logic in `lib/`, unit-tested — NOT in SQL)

> Pattern: SQL (Drizzle + `lib/metrics.ts` sum fragments) only **fetches grouped sums**; all decomposition/index math is a **pure TS function** in `lib/` with vitest tests. This satisfies "weighted aggregation via component sums" and keeps the tricky math testable. Every query applies `eq(performanceRecords.accountId, await getActiveAccountId())` and `excluded_from_aggregates = false` (unless `?includeExcluded=1`).

### 2.1 Within-audience expected baseline + Performance Index → `lib/campaign-benchmark.ts`
"Good" is contextual; benchmark **within the same platform & weeks**, excluding the campaign itself.

```ts
// Inputs: the campaign's weekly spend, and platform peer (spend, rev) per week (campaign subtracted out)
// expected = Σ_w (peerRev_w / peerSpend_w) * campaignSpend_w  /  Σ_w campaignSpend_w
// index    = round(campaignRoas / expected * 100)            // 100 = on-baseline
export function expectedRoas(weeks: { campaignSpend: number; peerSpend: number; peerRev: number }[]): number
export function performanceIndex(campaignRoas: number, expected: number): number
```
SQL: one query grouping the campaign's platform by `date_trunc('week', date)`, returning `sum(spend)`, `sum(conversion_value)`, and the same `FILTER (WHERE campaign_name = $campaign)` so peer = total − campaign. Reuse `roas`/`sumSpend`/`sumConversionValue` fragments.

Bullet bands (relative to expected): **under** `< 0.85×exp`, **on-par** `0.85–1.15×exp`, **above** `> 1.15×exp`. (Optional: also read `platform_rating_rules` thresholds for a secondary marker.)

### 2.2 Mix vs Rate bridge (Kitagawa, additive/MECE) → `lib/decomposition.ts`
Decompose the change in the campaign's weighted ROAS between **prior period (A)** and **current period (B)** into a **mix** effect (budget share shifting across creatives) and a **rate** effect (creatives' own ROAS changing). Periods come from the page's date range + compare mode via the existing `prevPeriod()` in `lib/period.ts`.

```ts
export interface PeriodCreative { id: string; name: string; spend: number; rev: number }
export interface BridgeResult {
  roasA: number; roasB: number; delta: number; mix: number; rate: number;
  contrib: { id: string; name: string; mix: number; rate: number; total: number }[];
}
export function mixRateDecomposition(A: PeriodCreative[], B: PeriodCreative[]): BridgeResult
```
Per creative `i` (union of A,B):
```
shareA = spendA_i / ΣspendA      shareB = spendB_i / ΣspendB
roasA  = spendA_i>0 ? revA_i/spendA_i : roasB_i      // absent in A ⇒ treat as pure mix
roasB  = spendB_i>0 ? revB_i/spendB_i : roasA_i
mix_i  = (shareB − shareA) * (roasA + roasB)/2
rate_i = (roasB − roasA) * (shareA + shareB)/2
```
`mix = Σ mix_i`, `rate = Σ rate_i`. **Invariant (assert in a test): `mix + rate ≈ roasB − roasA` within 1e-9.** `contrib[i].total = mix_i + rate_i`, sorted by `|total|` desc.

> ⚠️ Do **not** use a naive order-dependent waterfall — research flagged it as untrustworthy. This symmetric Kitagawa form is order-independent and reconciles exactly.

### 2.3 Within-campaign winners/losers + money-left-on-the-table → `lib/campaign-gap.ts`
```
campaignAvg = ΣcreativeRev / ΣcreativeSpend
losers      = creatives with roas < campaignAvg
topQ        = blended ROAS of creatives (desc by roas) until 25% of campaign spend
floorMissed = max(0, loserSpend*campaignAvg − loserRev)   // if losers were merely average
ceilMissed  = max(0, loserSpend*topQ       − loserRev)    // if losers matched the campaign's own best
```
Flag creatives with `< $150` spend as low-confidence (don't let a lucky tiny creative read as a "winner").

### 2.4 Retention curve (video only) → reuse `lib/metrics.ts`
Aggregate the campaign's video creatives: `[100, v25/v2, v50/v2, v75/v2, v100/v2] × 100`. Render only if `Σvideo_views_2s > 0`. Zone labels are interpretive (hook / pacing / offer) — static `ReferenceArea`s, no new math.

---

## 3. Data layer — `db/queries/campaign.ts`

Add (follow the file's existing typed-aggregation style; reuse fragments from `lib/metrics.ts`; scope by account; default-exclude):

```ts
export async function campaignBenchmark(campaign: string, range: Range): Promise<{ campaignRoas: number; expected: number; index: number; bandExpected: number }>;
export async function campaignBridge(campaign: string, range: Range, compare: CompareMode): Promise<BridgeResult>;          // fetches per-creative sums for current + prior, calls mixRateDecomposition
export async function campaignBreakdown(campaign: string, range: Range): Promise<{ creatives: CreativeGapRow[]; campaignAvg: number; floorMissed: number; ceilMissed: number; loserSpend: number; loserCount: number }>;
export async function campaignRetention(campaign: string, range: Range): Promise<{ stage: string; pct: number }[] | null>;  // null when no video
```
Each returns plain serializable objects (numbers, not Drizzle rows). `campaignBridge` runs two grouped queries (current range, `prevPeriod(range, compare)`), each `GROUP BY creative_id` returning `sum(spend)`, `sum(conversion_value)`, then calls the pure function.

**Indexing:** these filter `performance_records` by `(account_id, campaign_name, date)`. There's no index on `campaign_name` today. Add one in a **new Drizzle migration** (schema change ⇒ migration per CLAUDE.md): `index("perf_account_campaign_date_idx").on(accountId, campaignName, date)`. Declare it in `db/schema.ts` alongside the column, generate the migration, and run it against the **direct** Neon URL (see CLAUDE.md deploy section). This is the only schema change required.

---

## 4. Components — `components/campaign/` (new)

Recharts under shadcn charts; add `"use client"` only on the chart components. Use the shared palette in `lib/palette.ts` and the formatters in `lib/format.ts`.

| Component | Type | Notes |
|---|---|---|
| `campaign-verdict.tsx` | div-based bullet + big index number | bullet = 3 shaded bands + actual bar + expected tick (matches the mockup); color the index by ≥110 / 90–110 / <90 |
| `campaign-roas-bridge.tsx` | Recharts stacked `BarChart` waterfall | transparent base series + value series; 4 bars: ROAS-A → Mix → Rate → ROAS-B; green/red deltas; one-line plain-language "read" under it |
| `campaign-contribution.tsx` | diverging horizontal bars | top ~6 creatives by `|total|`, signed, green/red, zero line centered |
| `campaign-structure.tsx` | list + 3 summary tiles | per-creative spend bar colored win/lose vs campaign avg; tiles = loser count, money-left-on-table range, "move to make" |
| `campaign-retention-zones.tsx` | Recharts `LineChart` + `ReferenceArea` | retention curve with hook/pacing/offer zones; render only if data |
| skeleton variants | — | one per panel, matching final layout |

Reuse: `KpiTile` (header), `CampaignRecordsTable` (raw disclosure). **Remove the *usage* of** `FunnelStages`, `FunnelTrendChart`, `CampaignTrendChart`, `CampaignPlatformTable`, `CampaignCreativesTable` from the campaign page (all duplicate other pages / are superseded). **Follow §0.1 for what may be deleted vs. only un-imported** — `FunnelStages` & `FunnelTrendChart` are shared with `/funnel` and must NOT be deleted.

---

## 5. Validators & routing
Extend the detail page's searchParams via a Zod schema in `validators/campaign.ts`: `{ from?, to?, compare?: 'prev'|'wow'|'mom', includeExcluded?: boolean }`. Default range via `resolveDefaultRange()` (already used). The page stays a server component (`force-dynamic`); panels fetch in parallel (`Promise.all`) and stream behind `<Suspense>` with the per-panel skeletons.

---

## 6. Acceptance criteria

- [ ] `mixRateDecomposition` test: `mix + rate === roasB − roasA` (±1e-9) on random inputs; a mix-only fixture (shares move, rates constant) yields `rate≈0`; a rate-only fixture yields `mix≈0`.
- [ ] `expectedRoas` / `performanceIndex` tests with hand-computed fixtures; index of an on-baseline campaign ≈ 100.
- [ ] `campaign-gap` test: `floorMissed ≤ ceilMissed`, both ≥ 0; all-winners campaign ⇒ `floorMissed = 0`.
- [ ] All queries return identical numbers to the existing `campaignAnalytics` totals for the same range (cross-check ROAS/spend).
- [ ] Every panel has a skeleton and a designed empty/insufficient state (see §7).
- [ ] No `any`; `strict` passes; `npm run lint` + `vitest` green; `next build` succeeds.
- [ ] Page shows **none** of the §0 duplicated lenses.
- [ ] Numbers tabular-aligned; USD formatted; within-audience benchmark labeled as such.

---

## 7. Edge cases & empty states

- **Single creative** → bridge mix ≈ 0 (only rate); show a note "single creative — no budget-mix effect." Structure panel shows the one row.
- **No prior-period data** (campaign younger than the compare window) → bridge panel renders an insufficient-history state, not a broken chart.
- **No video creatives** → omit the retention panel entirely (don't render an empty card).
- **Zero spend in a period** → guard all divisions with `NULLIF`/JS guards; absent creative handled by the §2.2 fallback.
- **Meta campaigns** carry a `(Instagram)`/`(Facebook)` suffix in `campaign_name` — treat as-is (the identity already includes platform); benchmark uses that platform.
- **Low-sample creatives** (`< $150`) → render with a muted "low confidence" marker; exclude from the "best" used for `topQ` if it would distort (optional: require ≥$150 to qualify as the topQ benchmark).
- **`?includeExcluded=1`** → flip the default filter, consistent with the rest of the app.

---

## 8. Anti-patterns to avoid (from the research — do not violate)

1. **No treemap / sunburst** for the structure view — tested worst & least-preferred for this task; a sorted, colored drill list wins.
2. **No naive/order-dependent waterfall** — use the additive Kitagawa decomposition with the reconciliation assertion.
3. **No global "good ROAS" benchmark** — expected baseline is computed within platform × week; never compare Snapchat to Facebook.
4. **Don't re-display** the funnel, period-delta movers, tag/type/video rollups, or A/B lines — link out to those pages instead.

---

## 9. Suggested PR sequence (one feature per PR)

1. **PR1 — math + data layer (no UI):** `lib/decomposition.ts`, `lib/campaign-benchmark.ts`, `lib/campaign-gap.ts` + vitest; the four `db/queries/campaign.ts` functions; schema index + migration.
2. **PR2 — Verdict panel** (index + bullet).
3. **PR3 — ROAS bridge + contribution.**
4. **PR4 — Structure (winner/loser + money-left-on-table).**
5. **PR5 — Retention zones + remove duplicated panels + raw-data disclosure + polish/skeletons/empty states.**

Each PR is shippable; `main` stays deployable.

---

## Appendix — reference mockup & numbers
A working static mockup (real data from the campaign *"Ultra 3 | Sales ➤ New 17 Feb | Story"*, Snapchat) is in `analysis/campaign-redesign.html`, generated by `analysis/_campaign_redesign.mjs` (+ `_campaign_render.mjs`). It demonstrates the exact visuals and verified that this real campaign reads as **Index 121** (raw 2.38× vs 1.97× expected) and a bridge of **+0.70 rate / −0.64 mix** reconciling to **+0.06** total. Use it as the visual target.
