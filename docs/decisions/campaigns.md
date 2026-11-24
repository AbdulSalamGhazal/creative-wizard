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
  later ones come from "Add ad set" on its page, or "New ad set" on the Ad
  sets list, which asks WHICH campaign first — one dialog (`AddAdSetDialog`),
  one action (`addAdSets`). A Meta ad set ticked for Instagram and Facebook is
  TWO rows, as an upload reports it. The Ad sets list shows ad sets WITH
  records, so a new one is not in it yet: the success toast carries "Open
  campaign".
- **An ad set's stored name is ALWAYS `buildCampaignName(campaign, ad set,
  platform)`** and stays the upload-matching key, unique per BRAND — so the
  same `Campaign ➤ Ad set` cannot exist under two networks (the action names
  the platform that has it; E060 covers uploads — against the REGISTRY as
  well as stored records, so a name registered elsewhere and never run is
  refused too). Which campaign a built name
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
- **THE CAMPAIGN LEVEL IS ONE GROUP, EVERYWHERE (delivery 2, 2026-11-24).**
  Canvas, Compare, Funnel, Trends › Changes, the one-platform Dashboard and
  the MCP read a campaign as ONE group over the records of its ad sets —
  `campaigns.parent_id`, joined or sub-selected in the query layer — so its
  figures are component sums at every surface. Three shapes, never a fourth:
  the breakdown dimension `parent_campaign` (`breakdownDim`,
  db/queries/performance.ts), the filter `KpiFilters.parentCampaignIds`
  (Compare), and the Canvas fold (`canvasPairs`). Every ad set HAS a
  campaign (the link is NOT NULL), so nothing is left out of a campaign-level
  surface.
- **Which level a screen opens on is the user's decision, per screen:** the
  Canvas opens on AD SETS (`?level=campaign` switches; old links keep their
  meaning); Funnel, Trends › Changes and the one-platform Dashboard open on
  CAMPAIGNS (`?level=adset` / `?dim=campaign` switch back). `lib/breakdown-level.ts`
  is the one parser for Funnel and the Dashboard.
- **The switch's WORD is "By" — except on the Canvas (user decision,
  2026-11-24).** Funnel, the one-platform Dashboard and Trends › Changes say
  "By  Campaign · Ad set" (Changes: "By  Platform · Campaign · Ad set ·
  Creative") through ONE control, `ParamSwitch`. The Canvas keeps "Show
  Campaigns · Ad sets": "By" there already names its layout switch ("By ad
  set · By creative · By angle"), and the same word on two switches side by
  side would mean two things.
- **Where a campaign or an ad set is NAMED, the name is the way to its page**
  (2026-11-24): a platform's expanded rows on Funnel, the Dashboard's
  one-platform breakout (Type mix, Status flow, Spend by rating), Compare's
  totals row when a side is exactly ONE campaign or ONE ad set, and the audit
  log. Built only with `campaignPath` / `adSetPath`, on the page's range. The
  audit log resolves the page from the entry's ID (`AuditFeedRow.livePath`),
  never from the label stored when it was written — a rename keeps the link,
  a deleted row has none.
- **A campaign's key in a breakdown is its NAME — "Name (Network)" only when
  the brand has that name on two networks AND the query's platform filter
  spans more than one** (`parentCampaignKey`; pinned to one network — always
  the case on the one-platform Dashboard — a name is already unique); where a
  key must be stable (Compare's `xParents`, Trends rows, exclusion rules,
  `?focus=p:`) it is the campaign's id.
- **Saved views: the Campaigns list keys its own by `parent_campaigns`**
  (`PARENT_CAMPAIGNS_VIEW_PAGE`); `campaigns` stays the AD SETS list's stored
  key. A campaign view never appears on Ad sets.
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
- **Every ad set has a campaign: `campaigns.parent_id` and `adset_name` are
  NOT NULL** (the contract migration `campaigns_parent_not_null`, 2026-11-24,
  which re-runs the reconcile first — `campaigns_parent_reconcile_final` — so
  no row can fail it). An ad set is never written without both; tests seed
  one through `seedAdSet` (tests/db/fixtures.ts), never a bare insert.
- **THE WAY UP: an ad-set row names its campaign.** The Ad sets list and the
  ad-set tables on a creative's and a landing page's page carry a **Campaign**
  column linking to the campaign's page (`PortfolioCampaignRow.parentCampaign`
  / `CampaignMixRow.parentCampaign` + `network` — a PK join on the row the
  GROUP BY already has, never a parse of the stored name).
- **Searching the Campaigns list FINDS a campaign and keeps its WHOLE
  totals** (user decision, 2026-11-24): a campaign matches when any of its ad
  sets' stored names or creatives matches, and its row is then the sum over
  ALL its ad sets (`baseConds(…, "campaign")`) — never a partial campaign
  that looks like a whole one. The Ad sets list's search still narrows to the
  matching ad sets.
- **A list's Creatives total is a UNION, never a sum of its rows**
  (`PortfolioList.creativesTotal`): one creative in three ad sets is one
  creative in the footer.
- A perf row's AD SET is a **FK** (`campaign_id` → the `campaigns` registry);
  display names come from `campaigns.name`, never a text column.
- The registry name format is built ONLY through `buildCampaignName()`.
- Duplicates are keyed on (creative, platform, campaign_id, date, landing page)
  (the landing page joined the key in 2026-10 — see uploads-csv.md) — E050 intra
  file, E051 already-imported.
- The objective vocabulary is `CAMPAIGN_OBJECTIVES`; retired values never
  return, and a rename must sweep saved views.
- Deleting an ad set (`deleteCampaign`) removes its records in a transaction
  and KEEPS the creatives that ran in it — as the campaign delete above does.
- **An AD SET's platform is LOCKED once it has records (D9, 2026-10-23).**
  Each record carries its own platform; re-tagging the ad set made the two
  disagree and the old name's next upload hit E061. `updateCampaign` refuses
  inside its transaction ("This ad set already has records, so its
  platform can't change."); the edit dialog disables the select with an ⓘ
  saying why (`CAMPAIGN_PLATFORM_LOCKED` / `_TIP` in `lib/campaign.ts`).
  Before its first record it can move only inside its campaign's network.
  Its ad-set name and objective stay editable; the ad-set name is REQUIRED on
  edit as on create.

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

### Delivery 2 — the campaign level on the screens that worked per ad set (2026-11-24)

Delivery 1 gave the campaign a list and a page; six screens still read one
row per ad set. Built in one series, after a mockup and ONE batch of four
questions (all four recommendations taken):

- **Canvas** — `Show: Campaigns · Ad sets`; opens on ad sets, so every shared
  link, comment and "On the Canvas" button kept its meaning (`canvas.md`).
- **Compare** — its own `Campaign` row between Platform and Ad set (a mixed
  picker was declined: a campaign and one of its own ad sets could both be
  ticked). `xParents` holds campaign IDS; with ad sets picked too the two AND
  together, so picking a campaign prunes ad sets it doesn't contain in the
  same navigation. The campaign page's rail got Compare and Open in Canvas —
  no Compare for a Google campaign (Compare covers the platforms that report
  a funnel).
- **Funnel · Trends › Changes · the one-platform Dashboard** — open on the
  CAMPAIGN (the user's choice: the campaign is the level they think in; the ad
  set is one click away). Funnel's one switch drives the bottom table and what
  a platform expands into; a campaign row is ONE row across its platforms
  (Meta = Instagram + Facebook) listing its objectives. Trends keeps its own
  `?dim=` — `parent_campaign` is now the clean URL, `dim=campaign` the ad set.
- **Exclusions** — a "Whole campaign" rule (`exclusions.md`).
- **Saved views on the Campaigns list**, and the MCP (`mcp-diagnosis.md`).

Convention-level calls, reported: the campaign dimension INNER JOINs the
campaign (an unreconciled ad set is left out, as on the Campaigns list) rather
than inventing a nameless group; a campaign's breakdown key is its name with
the network added only on a real collision, computed in SQL in one fragment
so no consumer post-processes keys; Funnel's campaign row lists platforms and
objectives instead of repeating the campaign once per platform; the campaign
page hides Compare for Google rather than opening Compare on a side it can't
show; a record excluded by a whole-campaign rule names the campaign the rule
targets (one PK join in the two record queries).

Found in the signed-in walk, fixed before reporting: two campaigns that share
a name across networks (Always-On on Meta and on TikTok) were told apart only
by a dot's colour — the Canvas node, its search rows and the inspector's
pairings now say the network, Compare's option and chip carry it ("Always-On
(Meta)") only for such a name, and the Exclusions picker keeps the picked
campaign's network and ad-set count in the closed control.

Not built, on purpose: a campaign-level per-creative chart in Compare (a side
is still a filter, not a new chart), and any change to `get_funnel` (it has
no per-campaign rows at either level).

*The entries below were moved verbatim from CLAUDE.md (2026-10). Line
references are to the file as it stood before the restructure.*

### The sweep after the split (2026-11-24)

Once both deliveries were live the user asked for one more pass over the whole
system. Production was checked read-only first: 260 ad sets, 113 campaigns,
25,860 records — none without a campaign or an ad-set name, none on the wrong
network, no stored name that `buildCampaignName` would not rebuild. So the
contract step could land: `campaigns_parent_reconcile_final` re-runs the
reconcile and `campaigns_parent_not_null` sets `parent_id` and `adset_name`
NOT NULL.

What the sweep found and fixed, beyond wording:

- **E060 only looked at stored records.** A stored name registered on another
  platform that had never run was accepted by validation and then failed (or
  mis-filed) later. The validate route now also asks the registry.
- **The lists' Creatives footer summed its rows**, so a creative in three ad
  sets counted three times. It is a union now, computed in the query.
- **Nothing led from an ad set UP to its campaign** except its own page. The
  user chose where: a Campaign column on the Ad sets list and on the ad-set
  tables of the creative and landing-page pages (not the audit log).
- **Searching the Campaigns list returned partial campaigns** — only the
  matching ad sets' numbers under the campaign's name. The user chose full
  totals.
- **The cleanup tool could not pick a campaign**, only ad sets one by one. It
  has a Campaigns picker now: a campaign is every ad set under it at the time
  of the delete (`CleanupMatch.parentCampaignIds`), ANDed with the other
  filters like every picker there.
- **Activity:** a whole-campaign exclusion rule now shows in that campaign's
  Activity, and a campaign's rename shows in each ad set it renamed.
- **E061 names the network** ("Meta campaign 'Summer' is not registered"),
  because TikTok's Summer may well exist.
- A dead `/platforms/<key>` link on Trends › Changes (older than the split)
  was removed while there.

### The polish after the sweep (2026-11-24)

The sweep left a short list of things seen and not changed; the user asked
for all of them.

- **One word on the level switch.** Canvas said "Show", Funnel and the
  Dashboard "By", Changes had bare tabs. The user chose "By" everywhere — and
  then, shown that the Canvas already has a "By ad set · By creative" layout
  switch beside it, chose to leave the Canvas on "Show". The first question
  was asked before that clash had been looked for; it cost a second question.
  Changes' hand-rolled tabs became the house control (`ParamSwitch`, which
  `LevelSwitch` now wraps).
- **"New ad set" on the Ad sets list**, beside "New campaign" (now the
  quieter button there). With no campaign registered there is nothing to add
  one to, so "New campaign" stands alone as the main button.
- **Links to the campaign** in the four places that named one without a way
  to it: the audit log (declined in the sweep, asked for now), Compare, the
  Dashboard breakout and Funnel's platform expansion.
- **Funnel's platform CSV** put campaign and ad-set names under "Platform".
  It exports two columns now (`DataColumn.csvColumns`): the platform on every
  line, the name in its own.
- Two wordings on the Canvas: the search list says "Campaign" / "Creative"
  in full, and a campaign chip's tooltip says what its count is ("3 ad sets
  registered under this campaign · Sales").
- The Exclusions form's picker moved to `components/ui/search-select.tsx`
  unchanged, because "New ad set" needed the same control for the same list.

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
