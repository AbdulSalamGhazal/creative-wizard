/**
 * Pure helpers for the exclusion-rules engine ("materialized with provenance"):
 * a rule flips `performance_records.excluded_from_aggregates` on its matching
 * rows and stamps `excluded_source='rule'` + `excluded_rule_id` — aggregate
 * queries never change. The DB side lives in db/queries/exclusion-rules.ts;
 * this module is dependency-free so the invariants unit-test cleanly.
 *
 * Provenance invariants (do not weaken):
 * - A rule NEVER overwrites an existing exclusion (manual, or another rule's).
 * - Un-applying a rule touches ONLY rows with `excluded_rule_id` = that rule.
 * - Manual un-exclude refuses rows with `excluded_source='rule'`.
 */

export type ExclusionRuleKind = "campaign_objective" | "campaign" | "creative";

/** The target shape shared by rule rows, previews, and create inputs. */
export interface ExclusionRuleTarget {
  kind: ExclusionRuleKind;
  objective: string | null;
  campaignId: string | null;
  creativeId: string | null;
}

/**
 * Exactly the kind-matching target column must be set (the schema can't CHECK
 * this portably; every write path validates here). Returns an error message,
 * or null when valid.
 */
export function validateRuleTarget(t: ExclusionRuleTarget): string | null {
  const set = [
    t.objective !== null && t.objective !== undefined && t.objective !== "",
    t.campaignId != null,
    t.creativeId != null,
  ].filter(Boolean).length;
  if (set !== 1) return "A rule needs exactly one target.";
  if (t.kind === "campaign_objective" && !t.objective)
    return "An objective rule needs an objective.";
  if (t.kind === "campaign" && !t.campaignId)
    return "A campaign rule needs a campaign.";
  if (t.kind === "creative" && !t.creativeId)
    return "A creative rule needs a creative.";
  return null;
}

/**
 * Human descriptor for messages + audit meta, e.g. `objective: Sales`,
 * `campaign "Holiday ➤ Broad (IG)"`, `creative "URJ_VID_001"`. `targetLabel`
 * is the resolved campaign/creative name (ignored for objectives).
 */
export function ruleDescriptor(
  t: ExclusionRuleTarget,
  targetLabel?: string | null,
): string {
  if (t.kind === "campaign_objective") return `objective: ${t.objective}`;
  if (t.kind === "campaign") return `campaign “${targetLabel ?? t.campaignId}”`;
  return `creative “${targetLabel ?? t.creativeId}”`;
}

/**
 * Effective Excluded-toggle state: explicit URL param wins ("1" shown /
 * "0" hidden), else the user's saved preference, else hidden (safe default).
 * Pure — db/queries/user-prefs.ts feeds it the stored preference.
 */
export function resolveIncludeExcludedValue(
  raw: string | null | undefined,
  pref: boolean | null,
): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return pref ?? false;
}
