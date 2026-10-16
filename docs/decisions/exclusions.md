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
- Any edit path that can change a campaign's OBJECTIVE must release stale
  stamps and re-sweep, in the same transaction as the write.
- Rules are account-GLOBAL; the Excluded toggle is per-user.

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
  "Excluded by rule «…»" and the row's Re-include button is disabled) — restore
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
