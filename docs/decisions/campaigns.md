# Campaigns

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- **TWO LEVELS, AND THE CODE'S WORDS ARE THE OLD ONES (2026-11).** The UI's
  **Campaign** is a `parent_campaigns` row — `parentCampaign` in code, stored
  key `parent_campaign`. The UI's **Ad set** is a `campaigns` row — every
  identifier and stored key that says `campaign` (`campaign_id`, the comment
  anchor `campaign`, audit `campaign.*`, the rule kind `campaign`, the
  permission keys, the table key `campaigns`, the saved-view page `campaigns`)
  means the AD SET. Read "campaign" in code as "ad set"; never rename a stored
  key to tidy it. `lib/campaign.ts` ("TWO LEVELS") is the code's own note.
- **A campaign lives on ONE ad network** — `meta` (Instagram + Facebook
  together), `tiktok`, `snapchat`, `google` (`adNetwork`, DERIVED from the
  platform list). Unique per (brand, network, name), so one name may be a Meta
  campaign and a TikTok one. Its name never contains ` ➤ `.
- **Both levels are registered by hand.** "New campaign" registers the
  campaign and its first ad sets in ONE transaction (`createParentCampaign`);
  later ones come from "Add ad set" on its page (`addAdSets`). A Meta ad set
  ticked for Instagram and Facebook is TWO rows, as an upload reports it.
- **An ad set's stored name is ALWAYS `buildCampaignName(campaign, ad set,
  platform)`** and stays the upload-matching key, unique per BRAND — so the
  same `Campaign ➤ Ad set` cannot exist under two networks (the action names
  the platform that has it; E060 covers uploads). Which campaign a built name
  belongs to is ALWAYS `parentOfBuiltName` — never a raw cell.
- **Renaming a campaign rebuilds every ad set's name in the SAME transaction**
  (`updateParentCampaign`), refused on a collision. An ad set's own edit
  changes its ad-set name, platform (inside its network; locked by D9) and
  objective — never the campaign part.
- **Objective stays on the ad set.** A campaign's ad sets may carry different
  objectives (10 of Urjwan's campaigns did at the split), so a campaign only
  LISTS them; Budget's buckets and the objective rules read the ad set.
- **A campaign's numbers are component sums of its ad sets' RECORDS**
  (`{ parentId }` scope, `portfolioParentCampaigns`) — never a roll-up of
  per-ad-set ratios, and a creative in three ad sets counts once. It is active
  when ANY ad set is, from the one cached `campaignStatusMap()`.
- **Registry-first.** A campaign and an ad set with no records still have a
  page, and a never-run campaign is listed — a just-registered one must be
  reachable to add an ad set or fix a name before its first upload.
- **Deleting a campaign deletes its ad sets and their records**
  (`deleteParentCampaign` → `deleteParentCampaignRows`, one transaction, the
  creatives kept) behind the summary + type-the-name dialog. Deleting one ad
  set leaves its campaign.
- **Addresses:** a campaign is `/campaigns/<network>/<name>`, an ad set
  `/ad-sets/<stored name>`; a single segment under `/campaigns` is an old
  ad-set link and redirects. Build them only with `campaignPath` / `adSetPath`.
- `campaigns.parent_id` / `adset_name` are written by the app on every row but
  stay NULLABLE until a later contract migration — reads LEFT JOIN the
  campaign, and the `parent_campaigns_reconcile` migration is safe to re-run
  at any time.
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

### Campaigns and ad sets become two levels (2026-11-23)

At the start of the project the campaign and the ad set were merged into one
object "so it's easier for us". Every `campaigns` row was an ad set stored as
`Campaign ➤ Ad set`, and the campaign itself existed only as a prefix: no
total, no page, no comments, and a rename meant editing every ad set. The user
asked for an assessment; the live registries were measured first (Urjwan 191
rows → 76 campaign names, 52 of them with a single ad set, one with 33;
Mesbah 53; Brush 10; every name split cleanly on ` ➤ `).

Decisions, all the user's: add a PARENT table rather than rename the existing
one (ids, records, comments, rules and saved views untouched); a campaign is
per ad platform with Instagram + Facebook as one Meta campaign; both levels
registered by hand, the campaign with its ad sets on one screen; deleting a
campaign deletes its ad sets behind the confirm flow; two sidebar items;
core first. **Delivery 1** is the lists, the campaign page, registration,
uploads (E062), delete, the wording and the MCP. **Delivery 2** (not built):
the Canvas level switch, a campaign level in Compare / Funnel / Trends /
Dashboard, an exclusion rule for a whole campaign, saved views on the
Campaigns list.

Convention-level calls, reported: the stored vocabulary keeps `campaign` for
the ad set and the new level is `parent_campaign` (a code-wide rename would
have touched ~150 files and every stored key for nothing the user can see);
the objective stays on the ad set because the data says it is one; the
Campaigns list shows a never-run campaign so a new one can be found.

Not solved, on purpose: one stored ad-set name still cannot exist on two
platforms (Mesbah's hand-written "(Snapchat)" suffixes keep working), and an
ad set cannot be moved to another campaign.

Migrations (named, not numbered — Store migrations were landing every few
hours and the numbers moved under this branch): `parent_campaigns` (DDL) and
`parent_campaigns_reconcile` (data-only, mirroring `parseCampaignName`,
pinned against it by `tests/db/parent-campaign.test.ts`), both applied before
the deploy; the reconcile re-run after it; a contract migration (reconcile +
`SET NOT NULL`) follows as its own series once a rollback is off the table —
the 0023 / 0024 expand-contract shape.

*The entries below were moved verbatim from CLAUDE.md (2026-10). Line
references are to the file as it stood before the restructure.*

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
  across *different* campaigns on the same day is allowed. **[Superseded —
  the backstop is now `perf_identity_uq` on `(creative_id, platform,
  campaign_id, date, landing_page_id)` NULLS NOT DISTINCT, migration 0054;
  see `docs/decisions/uploads-csv.md`.]**

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
