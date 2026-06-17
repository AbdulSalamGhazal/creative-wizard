# Creative Wizard — End-to-End System Review & Strategy

> A deep review of the system as built, the 2025–2026 media-buyer market, and a prioritized roadmap to make Creative Wizard a best-in-class platform for media buyers and social marketers. Sources from a multi-agent research pass are cited inline.

---

## Part 1 — The system as it is today

### What it is
A **multi-tenant creative-performance analytics tool** for paid social (Instagram, Facebook, TikTok, Snapchat), fed by **manual CSV upload**. Strong analytical core: weighted-metric aggregation, a creative library with products/tags/dynamic status, ratings, record exclusion + audit trail, and a rich set of dashboards (Summary, Trends ×5, Funnel, Compare, Campaigns incl. the new **diagnosis** page, Creative detail).

### Data flow
`Platform export (CSV) → /uploads validate (5-stage) → commit → performance_records → dashboards`. Everything is **pull-on-page-load**; nothing runs in the background.

### Data model (grain & fields)
- **Fact table `performance_records`**, grain = `(creative_id, platform, campaign_name, date)`, daily.
- **Metrics captured:** spend, impressions, clicks, conversions, conversion_value, landing_page_views, **add_to_cart, add_payment** (optional), video_views_{2s,25,50,75,100}.
- `campaign_name` is a **text string** `"Campaign ➤ Adset"` (+platform suffix for Meta) — there is **no `campaign_id`/`adset_id`, no ad-account, no objective/audience/placement/device/geo, no budget/target** entity.

### Honest verdict on the gaps (the strategic openings)
| Capability | State |
|---|---|
| Platform API sync | ❌ none — 100% manual CSV |
| Real-time / freshness | ❌ data = last upload; recent-day lag not modeled |
| Write-back (pause/scale) | ❌ read-only |
| Automation / alerts / scheduled jobs | ❌ none |
| AI (tagging, insights, copilot, anomaly) | ❌ none |
| Reporting / export | screenshot-to-clipboard only; no PDF, no scheduled/client reports |
| Collaboration | notes + audit + saved views; no comments/approvals/briefs/tasks |
| Budget / pacing / objective / audience dims | ❌ not modeled |

**One-line takeaway:** a *very good passive reporting tool* with an unusually strong **creative-diagnosis** core — sitting on top of a manual, read-only, non-automated, non-AI foundation.

---

## Part 2 — The 2025–2026 market (synthesized, cited)

**The structural shift:** manual targeting is dead; **AI buying is the default** (Meta Advantage+ Sales — manual/ASC choice *eliminated*; TikTok Smart+; Snapchat Smart suite). Meta even *removed* detailed-interest targeting (hard cutoff Jan 2026). So **"creative is the new targeting"** is now literal algorithmic mechanics — the buyer's job has moved up the stack to **creative strategy, creative volume, and measurement hygiene.** (foxwelldigital; socialmediatoday; adligator; faniq)

**Ranked pain points** (from practitioner research):
1. **Creative fatigue is the #1 failure mode** — ads decay in *days*; 20–30% week-over-week engagement decay; must be tracked at **creative-ID level, weekly**. (searchengineland)
2. **Creative-production bottleneck** — AI buying demands **20–50 new variations/month**; production can't keep up. (madgicx; creatify)
3. **Manual reporting eats ~15–20 hrs/week** per mid-size agency. (swydo; whatagraph)
4. **Attribution trust / signal loss** — IDFA gone for ~75% of iOS; conversions are modeled; Meta shrank attribution windows Jan 2026 (removed 7/28-day view). (adlibrary; dataslayer)
5. **Fragmented cross-platform data** — Meta/TikTok/Snap live in separate dashboards; connectors are unreliable. (swydo)
6. **Reporting lag distorts recent days** — 24–72h backfill → the last few days under-report → premature kill decisions. (adlibrary; leadenforce)
7. **Scaling without losing efficiency** — CPMs +18%, ROAS sliding toward ~3:1. (adamigo)
8. **Collaboration friction** — incomplete briefs, scattered feedback, contested approvals. (martech.org)

**Competitive white space (the wedge):** the market splits cleanly into **"diagnose creative"** (Motion, Atria, Triple Whale) and **"execute changes"** (Revealbot, Madgicx, Smartly) — *almost no overlap.* Under-served corners: **cross-platform creative diagnosis** (everyone is Meta-deep, weak on TikTok/Snap), **within-audience benchmarking**, **proactive fatigue alerts** (explicitly a Motion gap), **automated narrative insights**, and **Snapchat / MENA / Arabic-RTL** (a measurement & reporting orphan). (motionapp; triplewhale; whatagraph)

**API feasibility:** read & **write** are viable on all three platforms — **Meta easiest**, **TikTok hardest** (slow app review, low base QPS). Design for **provisional recent days** (Snap exposes `conversion_data_processed_end_time`; Meta needs a 24–72h hold) and pair any rule-execution with **CAPI** because platform-reported conversions now under-count. (developers.facebook/tiktok/snap; dataslayer)

---

## Part 3 — Recommendations (prioritized)

Each: **Problem → Fit → DB → UI/UX → Integrations → Effort/Impact.** Ordered by the build sequence I recommend.

### 🅰 FOUNDATION (unlocks everything else)

#### A1. Native platform API ingestion (replace/augment manual CSV)
- **Problem:** the manual daily export→upload chore is the system's single biggest tax and caps data freshness; it blocks alerts, pacing, write-back, and AI. Fragmented data is pain #5.
- **Fit:** add a *new* ingestion path **alongside** the prized 5-stage validation — API rows flow through the *same* normalization/exclusion/audit so the validation moat is preserved. Reuse `platform_field_mappings` concept for API field maps.
- **DB:** new `ad_accounts` (id, account_id FK, platform, external_account_id, oauth token ref, status); `integration_connections` (oauth tokens, scopes, refresh, last_sync_at); `sync_jobs` (account, platform, window, status, rows, error). Add `campaign_id`, `adset_id`, `ad_id` (text) to `performance_records` so we stop parsing names. Add `objective`, `placement` where the API gives them.
- **UI/UX:** `/admin/integrations` — connect-platform cards (OAuth), per-account sync status, last-sync badge, manual "sync now". A subtle "Synced ✓ / CSV" provenance tag on data.
- **Integrations:** Meta Marketing API (async insights jobs), TikTok Business API (`reportTaskCreate`→poll), Snapchat Marketing API (`async=true`→poll). Vercel Cron (or a queue) for scheduled pulls. **Secrets:** encrypted token storage.
- **Effort: High · Impact: Very High.** Meta first (lowest friction), then Snapchat, then TikTok.

#### A2. Freshness / attribution-aware layer
- **Problem:** recent-day conversions under-report (pain #6); we *measured* this live (a −46% CvR "drop" on the latest 3 days was largely lag). Acting on provisional data → wrong kills.
- **Fit:** a cross-cutting data attribute consumed by every dashboard + every alert/rule.
- **DB:** add `data_maturity` / `is_provisional` flag per (platform, date) derived from each platform's finalization window; store `conversion_data_processed_end_time` (Snap) and a configurable hold (Meta 24–72h). A small `platform_attribution_config` table.
- **UI/UX:** provisional days rendered with a hatch pattern + "still attributing" tooltip across charts; a global "exclude provisional" default toggle. Rules/alerts skip provisional days.
- **Integrations:** none new (uses A1 sync metadata).
- **Effort: Low–Med · Impact: High** (pure trust; cheap once A1 exists). *Differentiator — almost no competitor models this honestly.*

#### A3. Data-model enrichment: budgets, objectives, IDs
- **Problem:** can't track pacing vs plan, can't slice by objective/audience, campaign rollups rely on string parsing.
- **Fit:** additive columns + one new `budgets` table; everything else inherits.
- **DB:** `budgets` (id, account_id, scope = account|campaign|product, target_spend, target_roas, period_start/end). Add `campaign_id/adset_id/ad_id`, `objective`, `placement`, optional `audience_label` to `performance_records` (backfilled from API; null for legacy CSV).
- **UI/UX:** budget setup in `/admin`; pacing surfaces in B3.
- **Effort: Med · Impact: High** (enables pacing, the #7 pain).

### 🅱 DIFFERENTIATING INTELLIGENCE (the white space — lean in here)

#### B1. Creative Fatigue Radar
- **Problem:** fatigue is the **#1 pain** and the clearest competitor gap (Motion has *no* fatigue alerts).
- **Fit:** productize the calendar-neutralized decay + CTR-decay analysis we prototyped; a new Trends sub-page + alert source.
- **DB:** none new for compute (derive from `performance_records`); `alerts` table (see C1) stores fired fatigue events. Optional `creative_fatigue_state` materialized cache for speed.
- **UI/UX:** `/trends/fatigue` — per-creative decay sparkline vs its own baseline, frequency proxy, a "refresh by" date, and a ranked "fatiguing now, still spending $X" list. Badge on creative detail.
- **Integrations:** none.
- **Effort: Med · Impact: Very High.** *Headline differentiator.*

#### B2. AI Insights Copilot + automated narrative diagnosis
- **Problem:** buyers drown in charts; turning data into "what's working & what to ship next" is analysis-paralysis (pain explicitly cited). Most tools show charts, not narratives.
- **Fit:** an ask-anything box + a generated **daily/weekly narrative** ("ROAS −23% — 71% is CvR, concentrated in 3 Jun-11 prospecting launches; recommend X"). This is exactly the analysis we've been doing by hand all session — now native.
- **DB:** `insight_runs` (account, period, prompt, output, model, created_at) for history/caching; reuse `audit_events` for provenance.
- **UI/UX:** a persistent "Ask" bar in the top nav; an "Insights" panel on the dashboard with the daily narrative + 3 recommended actions, each deep-linking to the relevant page.
- **Integrations:** **Claude API** (Anthropic SDK) with prompt caching; tools = the existing `db/queries/*` exposed as structured functions so the model reads *real* aggregates, not hallucinations.
- **Effort: Med · Impact: Very High.** *Modern, demo-able, sticky.*

#### B3. AI creative auto-tagging + cross-platform creative scoring
- **Problem:** tags are hand-curated (slow, inconsistent); cross-platform creative comparison is the biggest market gap.
- **Fit:** auto-suggest tags from the thumbnail/video on upload (hook type, format, talent, theme), feeding the already-excellent by-tag analysis; extend the skill-adjusted/within-audience score to a per-creative **Creative Score** card.
- **DB:** add `ai_tags jsonb` + `ai_tag_confidence` to `creatives`; a `creative_scores` cache (creative, platform, score, percentile, computed_at).
- **UI/UX:** tag suggestions in the creative editor (accept/reject); a "Creative Score" block on creative detail; a cross-platform creative leaderboard.
- **Integrations:** Claude API (vision) for tagging; thumbnails already in Vercel Blob.
- **Effort: Med · Impact: High.**

#### B4. Within-audience benchmark, account-wide
- **Problem:** "good ROAS" is contextual; judging Snapchat by Facebook's bar is wrong (we proved the audiences diverge).
- **Fit:** the Performance Index / expected-baseline already on the campaign page → promote to a **Summary column** and a creative-detail stat.
- **DB:** none (compute from `performance_records`); optional cache.
- **UI/UX:** an "Index" column on Summary (sortable), a band chip on detail.
- **Effort: Low–Med · Impact: Med–High** (reuses shipped logic).

### 🅲 ACTION & AUTOMATION (close the analysis→action loop)

#### C1. Alerting & digests (email / Slack / in-app)
- **Problem:** everything is manual; no proactive signal. Buyers must remember to look.
- **Fit:** a rules engine over the nightly synced data, gated by the A2 freshness layer.
- **DB:** `alert_rules` (account, metric, scope, comparator, threshold, window, channel), `alerts` (rule, entity, fired_at, value, status), `notification_settings`.
- **UI/UX:** `/alerts` — rule builder (templates: "fatigue", "spend pacing > X", "campaign ROAS < target for N days", "zero-conversion launch"), an alert inbox, Slack/email destinations.
- **Integrations:** Vercel Cron, Resend/SES (email), Slack incoming webhooks.
- **Effort: Med · Impact: High.**

#### C2. Automated rules **with write-back** (diagnose **and** act)
- **Problem:** the market's biggest structural gap — analytics tools don't act, automation tools don't diagnose. Doing both is genuinely novel.
- **Fit:** extend C1 rules from "notify" to "execute" (pause/scale/budget) via the platform APIs — **but gated**: only on *matured* (non-provisional) data + CAPI-backed conversions, with a confirm/preview and full audit (reuse `audit_events`).
- **DB:** add `action` + `execution_log` to the rules schema; `write_back_audit`.
- **UI/UX:** rule builder gains an "Action" step; a guarded "auto-execute" toggle; an execution history with one-click rollback where the platform allows.
- **Integrations:** Meta/TikTok/Snap **write** endpoints (A1 OAuth scopes) + CAPI for trustworthy conversions.
- **Effort: High · Impact: High — but risk-gated.** *Boldest differentiator; ship after A2 so it can't act on lagged data.*

#### C3. Budget pacing & reallocation tracker
- **Problem:** scaling-without-breaking-efficiency is pain #7; no plan-vs-actual today.
- **Fit:** uses A3 budgets; surfaces the within-platform "money-left-on-the-table" reallocation we built.
- **DB:** uses `budgets`.
- **UI/UX:** a pacing widget (spend vs target burn-down) + a reallocation suggestion list ("shift $X from below-avg to winners, within platform").
- **Effort: Med · Impact: Med–High.**

### 🅳 REPORTING & COLLABORATION

#### D1. Automated client/stakeholder reports (scheduled, white-label, **Arabic/RTL**)
- **Problem:** manual reporting = 15–20 hrs/week (pain #3); Snapchat/MENA reporting is an orphan; you already serve an Arabic market (Urjwan).
- **Fit:** scheduled render of a curated view → PDF/email; reuse saved views as report templates.
- **DB:** `report_templates` (view config, branding, locale), `report_schedules` (cadence, recipients), `report_runs`.
- **UI/UX:** `/reports` — build from a saved view, pick brand logo + **language (Arabic RTL)**, schedule, recipients; one-off "export PDF" too.
- **Integrations:** a render service (Puppeteer/`@vercel/og` or a render worker), Resend/SES, optional Slack post.
- **Effort: Med · Impact: High** (time saved is immediate ROI) — *Arabic/RTL is a clean MENA wedge.*

#### D2. Creative-ops collaboration loop
- **Problem:** collaboration friction is pain #8; the buyer↔creative loop (data → next brief) is where competitors are weak.
- **Fit:** lightweight comments/approvals + a "brief from insight" action that turns a finding (e.g. "Calm-Paced wins on FB") into a creative brief.
- **DB:** `comments` (entity, author, body, mentions), `briefs` (product, platform, angle, status, linked insights), `approvals` (entity, state, approver).
- **UI/UX:** comment threads on creative/campaign; a Kanban-ish brief board; "generate brief" button on insights/cheat-sheets.
- **Integrations:** optional Slack/Figma links.
- **Effort: Med–High · Impact: Med.**

### 🅴 ADVANCED MEASUREMENT (later, optional)

#### E1. Blended attribution + CAPI hub + incrementality-lite
- **Problem:** attribution trust (pain #4); platform numbers over/under-count and now under-report (Meta Jan 2026).
- **Fit:** a measurement layer reconciling platform-reported vs first-party (Shopify/Salla) orders; optional geo-lift/holdout helper. MMM is now the dominant method (61% of retail). (emarketer)
- **DB:** `orders` (first-party), `attribution_models`, `holdout_tests`.
- **UI/UX:** an attribution reconciliation view; a blended-ROAS toggle.
- **Integrations:** Shopify/Salla order API, Meta CAPI / TikTok Events / Snap CAPI.
- **Effort: High · Impact: Med–High** (deep, but a trust moat). *Don't try to out-Triple-Whale here early — scope to reconciliation + the lag story.*

---

## Prioritization (impact × effort)

| # | Feature | Impact | Effort | Tier |
|---|---|---|---|---|
| A2 | Freshness/attribution-aware layer | High | Low–Med | **Quick win** |
| B4 | Within-audience benchmark (Summary) | Med–High | Low–Med | **Quick win** |
| B1 | Creative Fatigue Radar | Very High | Med | **Do next** |
| B2 | AI Insights Copilot | Very High | Med | **Do next** |
| D1 | Automated Arabic/RTL reports | High | Med | **Do next** |
| C1 | Alerting & digests | High | Med | Do next |
| A1 | Native API ingestion | Very High | High | **Foundational bet** |
| A3 | Budget/objective/ID model | High | Med | Foundational |
| B3 | AI auto-tagging + creative score | High | Med | Build |
| C3 | Budget pacing tracker | Med–High | Med | Build |
| C2 | Automated rules + write-back | High | High | **Bold (gate on A2)** |
| D2 | Creative-ops collaboration | Med | Med–High | Later |
| E1 | Blended attribution / MMM-lite | Med–High | High | Later |

**Recommended sequence:** ship the **quick wins (A2, B4)** to prove the "trust + within-audience" thesis → the **intelligence layer (B1, B2, D1, C1)** which is your differentiation and is mostly compute over data you already have → then the **foundational API bet (A1, A3)** to kill the CSV chore and unlock → finally the **bold write-back (C2)**, safely gated on A2.

---

## Challenging the assumptions (think bigger)

1. **Your moat is creative diagnosis, not reporting.** The market is crowded with reporting tools and attribution suites; it is *thin* on cross-platform, within-audience **creative diagnosis with narrative insight** — which you already do better than most (campaign diagnosis page, skill-adjusted ROAS, fatigue). Double down there; don't try to become Triple Whale.
2. **The manual CSV is both your tax and your moat.** It's the biggest drag, but your validation/exclusion rigor is real quality control. When you add API sync (A1), **keep the validation layer** — "trusted, clean data" can be part of the pitch.
3. **Be the Snapchat/MENA + Arabic-RTL platform.** Snapchat is a measurement orphan and you're already MENA-native. First-class Snapchat + Arabic client reporting is a defensible wedge no incumbent is chasing.
4. **"Diagnose AND act" is the unclaimed corner.** Analytics tools won't pause an ad; automation tools won't tell you why. Owning both — *safely*, gated on matured data — is the boldest differentiation.
5. **AI copilot is no longer optional.** A natural-language analyst that reads your real aggregates and writes the daily diagnosis (what we did by hand this whole session) is now table-stakes-becoming and you're well-positioned to ship it cheaply.

---

*Research provenance: a 4-agent pass (internal codebase audit + 3 web-research agents on buyer workflows, the competitive tool landscape, and platform-API/optimization methods). Vendor-reported performance figures are directional. Verify exact API quotas/attribution rules against live official docs before building.*
