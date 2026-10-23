# Campaigns

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- A perf row's campaign is a **FK to the `campaigns` registry**; display names
  come from `campaigns.name`, never a text column.
- The registry name format is built ONLY through `buildCampaignName()`.
- Duplicates are keyed on (creative, platform, campaign_id, date, landing page)
  (the landing page joined the key in 2026-10 — see uploads-csv.md) — E050 intra
  file, E051 already-imported.
- The objective vocabulary is `CAMPAIGN_OBJECTIVES`; retired values never
  return, and a rename must sweep saved views.
- Deleting a campaign removes its records in a transaction and KEEPS the
  creatives that ran in it.
- **A campaign's platform is LOCKED once it has records (D9, 2026-10-23).**
  Each record carries its own platform; re-tagging the campaign made the two
  disagree and the old name's next upload hit E061. `updateCampaign` refuses
  inside its transaction ("This campaign already has records, so its
  platform can't change."); the edit dialog disables the select with an ⓘ
  saying why (`CAMPAIGN_PLATFORM_LOCKED` / `_TIP` in `lib/campaign.ts`).
  Name and objective stay editable.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Campaign identity = campaign_id FK

<!-- was CLAUDE.md L488–506 -->

- **Campaign identity = `performance_records.campaign_id` FK (normalized).** A
  perf row's campaign is a FK to the `campaigns` registry — NOT a text column.
  (The old denormalized `campaign_name` text was dropped in migrations 0023
  expand / 0024 contract; reads `JOIN campaigns` and source the display name from
  `campaigns.name`, writes resolve `campaign_id` from the registry by
  `(account_id, built-name)`.) The registry name is the combined `Campaign ➤
  Adset` value — and for **instagram/facebook** a short platform tag is appended
  (e.g. `Holiday ➤ Broad (IG)` / `(FB)`) so the same Meta campaign split across
  the two stays distinct. That name format is built ONLY through
  `lib/campaign.ts` `buildCampaignName()` (the `PLATFORM_TAG` map; used by the
  CSV pipeline, the create-campaign action, and the seed) — don't open-code it.
  Because a renamed/re-tagged campaign is now a single-row update to
  `campaigns.name` (every perf row follows via the FK), there's no bulk
  campaign_name rewrite anymore; the one-off `shorten-platform-tags.ts` that did
  the `(Instagram)→(IG)` rewrite was deleted post-normalization. Duplicates are
  keyed on `(creative, platform, campaign_id, date)` and rejected via E050
  (intra-file) / E051 (already-imported, joins `campaigns`) plus the
  `perf_creative_platform_campaign_id_date_idx` unique index. The same creative
  across *different* campaigns on the same day is allowed.

### Campaign objectives merged

<!-- was CLAUDE.md L1531–1544 -->

- **Campaign objectives merged 2026-09 (migration 0034):** the vocabulary is
  exactly **Sales, Prospecting, Retargeting, Awareness, Activation, Special
  Case** (`CAMPAIGN_OBJECTIVES` in lib/campaign.ts — everything derives from
  it; "Special Case" was added new, later in 2026-09). "Reach&Freq", "Traffic"
  and "Video Views" were RETIRED and every existing campaign carrying one was
  renamed to "Awareness" (saved campaign-view objective filters were swept +
  deduped too). Never reintroduce the removed values. **Any future objective
  rename/merge must ALSO sweep `budget_allocations.objective` (and saved
  views)** — this was true until 2026-09. **Superseded: `budget_allocations`
  now stores BUDGET BUCKETS, not campaign objectives** (see the Budget bullet's
  objective-bucket entry). A campaign-objective rename touches
  `toBudgetObjective` in lib/budget.ts and nothing else in Budget; saved views
  still need the sweep.
