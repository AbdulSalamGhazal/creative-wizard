# Creatives, priority, stage and angles

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- A thumbnail URL is a file in OUR public Blob store (https,
  `*.public.blob.vercel-storage.com`) or nothing — `data:`, `http:` and
  other hosts are refused by the validators (W1-13, 2026-10-23).
- **Every creative has a required `product_id`.** Never let one be saved
  without it.
- **A creative name never contains ` @`** (create, rename, bulk import —
  `creativeNameSchema` / `hasLandingMarker`): uploads split an ad name there
  for its landing-page code, so such a creative could never be matched. See
  uploads-csv.md.
- The detail page edits EVERYTHING inline — there is no `/edit` route, and
  `patchCreative` never touches notes.
- **Priority = manual judgment; Rate = computed performance.** Never conflate
  the words. UNRATED sorts LAST in both directions.
- **Stage has THREE states** — unassigned `[]`, the declaration `["N/A"]`, or
  real stages — and an absence must never look like a declaration. N/A is
  EXCLUSIVE and creative-side only; **never widen `FUNNEL_STAGES`**.
- Stage is NEVER auto-derived, and its mismatch with a campaign's objective is
  INFORMATION, not an error.
- Deleting a creative removes its `performance_records` first, in a
  transaction, because that FK has no cascade.
- The concept is an **angle**, never a "tag" — at every layer.
- **Every assignment is a vocabulary row.** Any path that writes
  `creative_angles` (create, patch, bulk import) writes the `angles` row in the
  SAME transaction through ONE helper, `addToVocabulary`
  (db/queries/angles.ts); migration 0062 backfilled the assignments that
  predate it. So the Library's Angles tab lists every angle in use, and a
  rename or delete there reaches every creative. Un-assigning keeps the word:
  the vocabulary is curated on that tab, never derived. Pinned by
  `tests/db/angle-vocabulary.test.ts`.
- **"Add" in the detail dropdown edits the DRAFT.** Nothing is stored until
  "Save changes"; the dropdown's copy says so, and leaving with an unsaved
  draft asks first (`UnsavedChangesGuard`, ui-system.md).
- **`createCreative` revalidates `/library/new`** although its caller
  navigates away — the documented exception to one-render-per-action
  (ui-system.md): Back returns to the form from the router cache, which only a
  revalidation purges.
- **The Library has ONE order: `sortCreativeRows` (lib/creative-sort.ts).**
  `listCreatives`, the detail page's prev/next pager and the client's sort
  click all call it, so they can't disagree; text compares through one
  explicit collator (`compareText`, "en"), never the runtime locale or the
  database collation. The pager reads `listCreativeSequence` (same WHERE as the
  listing, only the columns the sort needs) — never the full listing.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### The detail page edits everything inline

<!-- was CLAUDE.md L546–557 -->

- **Creative detail page edits EVERYTHING inline; there is no `/edit` route.**
  The detail header (`components/creative/creative-detail-header.tsx`, a client
  component) is a full editor for name / product / type / status / thumbnail /
  publish-date / **priority** / angles, with draft state + a dirty check + an
  explicit **Save changes** button (not auto-save). Save calls `patchCreative`
  (partial — only changed fields; renaming is uniqueness-checked and the client
  follows the new URL). The old `/library/[name]/edit` page,
  `creative-edit-form.tsx`, and the `updateCreative` action were DELETED — don't
  reintroduce them. Notes stay on their own inline editor (`updateCreativeNotes`
  via NotesPanel); `patchCreative` never touches notes. Angle editing uses
  `angle-multi-select.tsx` (a Popover dropdown), and the publish date uses a
  Calendar popover.

### Priority ≠ Rate

<!-- was CLAUDE.md L558–583 -->

- **Priority ≠ Rate — two DISTINCT concepts, never conflate the names.**
  **Priority** (2026-07) is the team's MANUAL importance judgment on a creative:
  `creatives.priority smallint` NULLABLE, 1..3 (3 = highest), NULL = unrated (a
  real default state — never a numeric 0, never auto-set). Field/validator/label
  are all `priority` (`prioritySchema` in `validators/creative.ts`); it's edited
  inline on the detail header (3 lucide `Star` icons, warn-amber fill) via the
  normal draft/Save flow. Migration 0028 (additive, no index — superseded:
  since it is sorted and filtered, migration 0061 indexes `(account_id,
  priority)`, W3-8).
  **SUPERSEDED 2026-09 — Priority is now VISIBLE, SORTABLE and FILTERABLE.** The
  old "detail page only, no list/summary/CSV/filter" scope was reversed by the
  user. It now appears on **Library** (a column of filled stars, sortable, a
  3 · 2 · 1 · Unrated filter) and **Ads/Summary** (with the pinned creative-
  identity columns — NEVER inside a per-platform metric group, since priority is
  a per-creative field — sortable, same filter, hideable like its sibling
  identity columns); both CSVs carry it, with unrated as an EMPTY cell. Shared
  vocabulary lives in `lib/priority.ts`; the read-only star display is
  `components/creative/priority-stars.tsx`. **UNRATED SORTS LAST IN BOTH
  DIRECTIONS** (`comparePriority`) — an absence of judgment is not a low one, so
  Postgres' default NULL placement is overridden (`NULLS LAST` in the Library's
  SQL sort, a JS re-sort on Summary where the base order is spend). The Ads
  filter pill uses a FLAG icon, not a star: `Star` already means **Rate** in that
  bar, and these two must never read as one thing. **Rate** is a
  totally different, COMPUTED concept — the ROAS-driven performance chips
  (`rating_rules` / `lib/rating.ts` / Summary "Rate" filter). Rule: **Rate =
  computed performance; Priority = manual judgment.** The word "rating" must
  NEVER name the Priority feature, and "stars" is only the UI metaphor (the icon)
  — it appears nowhere in the schema/code.

### Stage — the manual funnel declaration

<!-- was CLAUDE.md L584–641 -->

- **Stage (2026-09) — the creative's MANUAL funnel declaration. A STANDING
  DECISION.** `creatives.stages text[] NOT NULL DEFAULT '{}'` (migration 0045,
  additive, GIN index — it's filtered by OVERLAP): any 1, 2 or all 3 of
  **Awareness · Activation · Retargeting**, or the explicit **N/A**.
  - **THREE STATES, not two (2026-09).** `[]` **unassigned** = "not yet
    declared" (a real default state); `["N/A"]` = "declared: **no clear
    stage**" — someone looked; otherwise the declared stages. The Library/Ads
    column renders unassigned as an em-dash and N/A as its own MUTED (dashed,
    ink-3) chip: an absence and a declaration must never look alike.
  - **N/A is EXCLUSIVE and CREATIVE-SIDE ONLY.** A creative is N/A or carries
    real stages, never both — the picker normalizes (picking N/A clears the
    rest and vice versa) and `stagesSchema` REJECTS the combination, so a
    hand-rolled request can't store the contradiction; bulk import says the
    same thing per row. The vocabulary split is the guard: `FUNNEL_STAGES`
    stays EXACTLY the three (it feeds the Audience matrix and the
    Budget-bucket mapping, where "N/A" would be nonsense) and the new
    `CREATIVE_STAGE_OPTIONS = [...FUNNEL_STAGES, NA_STAGE]` is what the
    creative side uses. **Never widen `FUNNEL_STAGES`**; a test pins its
    length and asserts `lib/audience.ts` / `lib/budget.ts` never import the
    creative vocabulary.
  - **NEVER auto-derived.** Not from the campaign objective a creative happens
    to run under, not from where it spends. It is the team saying where the
    creative sits, and nothing may infer it for them.
  - **A DIFFERENT AXIS from the campaign Objective and the Budget buckets.** A
    creative declared Retargeting can spend inside an Awareness campaign, and
    that mismatch is INFORMATION, not an error — never "fix" it, never warn on
    it, never reconcile the two.
  - **One vocabulary, `lib/funnel-stages.ts`** (`FUNNEL_STAGES` /
    `CREATIVE_STAGE_OPTIONS` / `STAGE_SHORT` / `stageLabel` / `sortStages` /
    `compareStages`), derived from
    `BUDGET_OBJECTIVES` minus "Other" and RE-EXPORTED by `lib/audience.ts` —
    hoisted there so the creative and audience sides share one definition.
    Never re-list the stage names (not in SQL either: the Library and Summary
    stage sorts run in JS through `compareStages` rather than encoding the
    funnel order in an ORDER BY).
  - **Sort rule: by the EARLIEST stage in funnel order, UNASSIGNED LAST in both
    directions** ({Awareness, Retargeting} ranks as Awareness). Same shape as
    Priority's unrated-last rule. **N/A is a DECLARATION, so it sorts** — last
    of the declared, ahead of unassigned: Awareness < Activation <
    Retargeting < N/A < unassigned.
  - **Filter semantics: OVERLAP** — a creative matches if ANY selected stage is
    on it; **"N/A" and "Unassigned" are SEPARATE tokens** asking different
    questions (the declaration vs. the empty array), and every filter bar
    derives its options from `STAGE_FILTER_VALUES`, so Library, Ads and Canvas
    all gained N/A at once. Surfaces: the detail header (toggle chips in the
    draft/Save flow — the N/A chip sits behind a divider, muted), the create
    form, bulk import (a `stage`/`stages` column, full names, TOF/MOF/BOF, or
    `N/A`/`NA`), Library + Ads columns (compact chips, sortable, filterable, in
    both CSVs — the CSV writes the literal `N/A`), and MCP
    (`list_creatives`/`get_creative` output + a `stages` filter).
  - **"N/A" means different things on different surfaces — do not conflate.**
    On the creative stage column it is a VALUE; on the ads/performance CSV
    pipeline `csv/numeric.ts` reads "N/A" in a NUMERIC cell as an empty marker
    (→ 0). They share no normalizer: the creative bulk import reads raw cells
    from `csv/parse.ts`. A test pins both halves.
  - **Naming discipline, like Priority ≠ Rate:** **"Stage" is the CREATIVE's
    field; "Objective" stays campaigns-only; "bucket" is Budget's.** Don't let
    the three words drift into each other.

### Deleting a creative is a hard delete

<!-- was CLAUDE.md L812–818 -->

- **Deleting a creative is a hard delete** (`deleteCreative`). It removes the
  creative's `performance_records` first (no cascade on that FK), then the
  creative (angles cascade). The confirm dialog
  (`components/creative/delete-creative-dialog.tsx`) shows the exact record
  count + per-platform breakdown + date range from `creativeDeletionSummary`,
  and an acknowledgement checkbox gates the destructive button — plus, since
  D23 (2026-10), typing the creative's name (`TypeToConfirm`): every record
  goes, so it takes the cleanup tools' full preview → acknowledge →
  type-to-confirm (the campaign delete does the same). The audit row
  (`creative.delete`) survives because it stores a label, not an FK.

### tag → angle at all layers

<!-- was CLAUDE.md L1891–1910 -->

- **2026-09: "tag" → "angle" at ALL layers — DB, URL params, code, UI, MCP.**
  The creative-labeling concept is called an **angle** now. Tables `tags` /
  `creative_tags` became `angles` / `creative_angles` (column `tag` → `angle`),
  the permission key `catalog.tags` became `catalog.angles`, the `?tags=` filter
  param became `?angles=`, `/trends/by-tag` became `/trends/by-angle` (old route
  kept as a redirect stub), and the MCP `tags` field/filter became `angles` (a
  BREAKING change for connected clients — no alias, called out in the tool
  descriptions and the connect panel). Migration **0037** is a hand-written
  RENAME (never regenerate it — `drizzle-kit generate` emits DROP+CREATE and
  would destroy every assignment) that also sweeps the stored strings in
  `users.permissions` and `summary_views.query`. **Never reintroduce "tag" for
  this concept.** Two things deliberately keep the old word: historical
  `audit_events` rows keep their `tag.*` action strings (append-only; rendered
  with their original wording via `LEGACY_AUDIT_LABELS` in `lib/audit.ts`), and
  the campaign-name **platform tag** (`PLATFORM_TAG` in `lib/campaign.ts`, the
  ` (IG)`/` (FB)` suffix) is a different concept that keeps its name. The
  account-scoped-cascade invariant carries over verbatim: `creative_angles` has
  no `account_id`, so angle rename/delete cascades MUST be bounded by a
  `creatives WHERE account_id` subquery.

### The pager stopped loading the Library (2026-10, W2-4)

- The detail page rebuilt its prev/next sequence with `listCreatives` — the
  Library's heaviest query (two spend-window CTEs over `performance_records`,
  every BRAND's angles, notes, creators) — on every view and every step, to
  read the names. `listCreativeSequence` reads the same creatives through the
  same WHERE (`creativeListConditions`, shared) and only the columns the sort
  needs: the spend windows only for a spend sort, the angles only for an
  angle sort, the status from the request's cached inputs. The order is the
  shared pure comparator, which the listing now uses too — its SQL `ORDER BY`
  and the three JS re-sorts are gone. Pinned by
  `tests/db/creative-sequence.test.ts` (every sort value and every carried
  filter: pager == listing) and `lib/creative-sort.test.ts` (each rule).
- In the same pass: the link from the Library carries priority, stage and
  Excluded, but the pager dropped them, so a filtered Library walked a
  different sequence — it now honours all of them; the creative's angles ride
  in `getCreativeByName`'s query; the termination set, the data horizon and
  the first day derive from reads the page already makes; `angle_agg` is
  scoped to the brand. Measured: `/library/[name]` 26 → 22 queries, client
  props byte-identical on the local data.
- One semantic note: a creative with no spend in a window used to sort after
  one with a stored $0 (SQL `NULLS LAST` on a NULL that displays as $0). Both
  show $0, so the comparator treats them as equal and orders them by name.

### Angles typed on a creative never reached the vocabulary (2026-10-26)

- **The report.** The Mesbah team: "we are unable to add angles — when
  creating one, it doesn't appear in the others; we create the same one over
  and over." Reviewed as the second brand's bug; it was three things, none of
  them brand-specific in code, all of them things only a NEW brand does.
- **What was true.** Assigning an angle wrote `creative_angles` only. The
  vocabulary (`angles`) grew through the Angles tab alone — and the dev seed,
  which backfilled Urjwan's from its assignments, so Urjwan's tab looked
  complete and nobody noticed. The tab's empty state had promised "angles get
  created when you assign one to a creative" since the rename (2026-09-06),
  and no code path had ever done it. In a fresh brand every typed angle was
  invisible there. The dropdowns were fine (`listAllAngles` unions both
  sources) — the tab said angles were not being created.
- **The reproduced symptom.** Create a creative on `/library/new` with a new
  angle, land on its page, press Back: the form came back from the Router
  Cache with NO refetch (network log), so its suggestion chips still lacked
  the angle just typed — on every creative, which is exactly how a brand gets
  onboarded. `createCreative` deliberately did not revalidate (W2-1); nothing
  else purges the router cache, and Back reads it regardless of staleness. The
  detail page was never affected: `patchCreative` revalidates, and Back after
  a save refetched.
- **The third.** The dropdown said "press Add to create it"; Add only edits
  the draft, Save changes sits at the top of the header (off-screen on a
  phone when the Angles control is in view), and leaving discarded the draft
  silently — no guard anywhere in the app.
- **The fix.** One writer (`addToVocabulary`) in every assignment's
  transaction + migration 0062; `createCreative` revalidates `/library/new`
  (one extra small render, the exception recorded in ui-system.md); the
  dropdown's copy names both steps; the house `UnsavedChangesGuard` on the
  detail header. Walked signed-in on a second brand before and after.
