# Google and the platform metric set

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- Google is an ordinary platform; **its only special behaviour is its data
  SHAPE**. Identity, uploads and creatives take the standard path.
- The unavailable set is DECLARED ONCE in `FIELD_META.unavailableOn`; never
  hand-list the fields or the platform at a consumer.
- **NULL ≠ 0.** "Never measured" is not "measured zero", and only NULL keeps a
  row out of BOTH sides of a blended rate.
- Any ratio touching an unreported field **excludes those platforms from BOTH
  sides** (`lib/metrics.ts`), or a real 25% reads as 250%.
- `PLATFORMS_WITH_CREATIVES` scopes the surfaces that compare platforms on
  metrics google doesn't report; the FUNNEL surfaces exclude google WHOLESALE,
  rows and all, so the page tells one story.
- `lib/funnel-totals.ts` is the JS mirror of that guard, and mid-funnel sums
  stay NULLABLE all the way to the UI.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Google — standard pipeline, reduced metrics

<!-- was CLAUDE.md L1966–2054 -->

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
