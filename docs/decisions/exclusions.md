# Exclusions

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- **`excluded_from_aggregates` has exactly TWO writers**: the manual per-record
  action (`'manual'`) and the rules engine (`'rule'` + `excluded_rule_id`).
  Nothing else may flip it.
- Applying a rule SKIPS already-excluded rows; un-applying touches only rows
  with that rule's id AND `excluded_source='rule'`, then RE-SWEEPS the
  remaining active rules.
- **Manual un-exclude REFUSES a rule-excluded row** — restore it by
  deactivating the rule.
- Any edit path that can change an AD SET's OBJECTIVE must release stale
  stamps and re-sweep, in the same transaction as the write.
- Rules are account-GLOBAL; the Excluded toggle is per-user.
- **FOUR KINDS, one target each (the schema CHECKs it):** `campaign_objective`,
  `parent_campaign` (a whole CAMPAIGN), `campaign` (ONE ad set — the stored
  word), `creative`. The vocabulary is `exclusionRuleKindEnum` (lib/enums);
  never re-list it.
- **A whole-campaign rule is its campaign's ad sets AT SWEEP TIME** —
  `campaigns.parent_id`, resolved inside `ruleMatchConds`, never a stored
  list. So an ad set added later is covered by the next sweep and its first
  upload lands excluded (user decision, 2026-11-24), with no extra writer.
  It needs no "release stale stamps" step ONLY because an ad set cannot move
  between campaigns; the day one can, that edit path must release and
  re-sweep in its transaction, exactly as an objective edit does.
- Deleting a campaign deletes the rule that targets it AND the rules on its
  ad sets, in the same transaction, AFTER its ad sets' records
  (`deleteRulesTargetingCampaigns`, then `deleteRulesTargetingParentCampaign`
  — the FK has no cascade, like its siblings). Deleting one ad set deletes
  that ad set's rule (`deleteRulesTargeting`).

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Exclusion provenance — two writers

<!-- was CLAUDE.md L1508–1530 -->

- **Exclusion provenance (2026-09): the `excluded_from_aggregates` flag has TWO
  writers and they never overwrite each other.** `excluded_source` says who
  flipped it — `'manual'` (per-record action) or `'rule'`
  (`excluded_rule_id` → `exclusion_rules`, the account-global rule engine in
  `lib/exclusion-rules.ts` + `db/queries/exclusion-rules.ts`; "materialized
  with provenance" — aggregate queries never special-case rules). Invariants:
  applying a rule SKIPS already-excluded rows (manual, or another rule's — a
  row keeps its FIRST rule, created_at order); un-applying touches ONLY rows
  with that rule's id AND `excluded_source='rule'`, and the removal transaction
  then RE-SWEEPS the remaining active rules, so a row covered by two rules stays
  excluded (re-stamped by the survivor) instead of silently returning to totals;
  **manual un-exclude REFUSES rule-excluded rows** (the action returns
  "Excluded by rule «…»"; the row shows no Re-include at all but "By rule
  «Objective awareness»" — the rule named by kind and target, linking to
  Configuration → Exclusions — and its badge reads "Excluded · rule" (R-007,
  2026-11; rules have no name, `lib/exclusion-rule-label.ts` words them)) — restore
  them by deactivating the rule in Configuration → Exclusions (still there). Rule mutations
  reuse `record.exclude` but are always preview-then-confirm with an
  acknowledgement checkbox, and audited (`exclusion.rule_*`) with the count the
  engine ACTUALLY flipped. New/upserted uploads are stamped against ACTIVE
  rules inside the commit transaction; `deleteCreative`/`deleteCampaign` delete
  rules targeting the entity in-transaction (the FK has no cascade on purpose).
  The Excluded TOGGLE is per-user (`users.include_excluded`, resolution URL →
  pref → hidden); the RULES are account-global — pausing one changes everyone's
  numbers.


### Objective edits must re-derive stamps

<!-- was CLAUDE.md L1944–1954 -->

- **Campaign OBJECTIVE edits must re-derive exclusion stamps (2026-09).** The
  rules engine only ever ADDS stamps (`applyRule` skips already-excluded rows),
  so nothing re-evaluated existing ones when a campaign was re-classified.
  `updateCampaign` now runs, in ONE transaction with the write and only when the
  objective actually changed: `releaseStaleObjectiveStamps` (drops THIS
  campaign's stamps from `campaign_objective` rules that no longer match,
  guarded by `excluded_source='rule'` so manual exclusions survive) then
  `resweepActiveRules`. Any future edit path that can change a campaign's
  objective must do the same, or the rules page and every aggregate silently
  disagree with the rules.

### A rule for a whole campaign (2026-11-24)

Delivery 2 of the campaign / ad set split (`campaigns.md`). A rule could name
an objective, one ad set or one creative; excluding a campaign meant one rule
per ad set, and the next ad set added to it came back into totals unnoticed.

- **Kind `parent_campaign`**, target column `exclusion_rules.parent_campaign_id`
  (FK to `parent_campaigns`, no cascade), its own partial unique index, and
  the one-target CHECK widened to four branches — migration
  `exclusion_rules_parent_campaign`, additive: old code never sets the
  column, so every existing rule still passes the new CHECK.
- **User decision: it covers ad sets added LATER.** The alternative (freeze
  the ad sets the campaign had) was declined. Matching through
  `campaigns.parent_id` at sweep time gives that for free: `applyRule`,
  `resweepActiveRules` and the commit route's `stampAgainstActiveRules` are
  untouched, and the two-writers rule holds by construction — the engine is
  still the only code that stamps `'rule'`.
- **Overlap is the existing rule:** a row keeps its FIRST rule. An ad-set
  rule created after its campaign's rule stamps nothing; removing the
  campaign rule re-sweeps and the ad-set rule takes its rows (pinned).
- **Words:** the form's kind is "Whole campaign"; the picker's hint is the
  network and the ad-set count (a campaign name is unique only per network,
  and the count is what the rule will cover); the list shows the network
  beside the name; a record says `Campaign «name»`; the confirm dialog adds
  "including ad sets added to this campaign later" — the one thing its
  preview counts cannot show.
- **Found by the type system, fixed:** the rule kind was hand-listed in four
  places (`lib/exclusion-rules.ts`, `lib/exclusion-rule-label.ts`, and the
  record rows of `db/queries/campaign.ts` / `creatives.ts`); all four now
  derive from `exclusionRuleKindEnum`.
- MCP: not relevant — rules stay an admin surface (`coverage.ts`: `no`);
  every tool already reports excluded records through `include_excluded`.
- Tests: `lib/exclusion-rules.test.ts`, `lib/exclusion-rule-label.test.ts`,
  and `tests/db/campaign-level.test.ts` — the sweep, the later ad set, the
  re-sweep, tenancy, delete-campaign, and the CHECK itself.
