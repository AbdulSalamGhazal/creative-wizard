import type { ExclusionRuleKind } from "@/lib/enums";

/**
 * The words for "which rule excluded this record" (R-007). Rules carry no
 * name of their own — a rule IS its target — so a record names it by kind
 * and target: "Objective awareness", "Campaign «Launch»", "Ad set «Launch ➤
 * Broad»", "This creative". A records table already knows the row's ad set /
 * creative, so the caller passes what it has; a target it can't name falls
 * back to the kind.
 */
export type ExclusionRuleKindLike = ExclusionRuleKind;

/**
 * A rule KIND in the UI's words — one map for the rules admin's picker and
 * the audit log's summary line, so a stored key (`campaign` = ONE ad set,
 * `parent_campaign` = a whole campaign) never reaches the screen raw. The key
 * order is the picker's order: widest net first.
 */
export const EXCLUSION_RULE_KIND_LABEL: Record<ExclusionRuleKind, string> = {
  campaign_objective: "Ad set objective",
  parent_campaign: "Whole campaign",
  campaign: "Specific ad set",
  creative: "Specific creative",
};

export function exclusionRuleLabel(
  rule: { kind: ExclusionRuleKindLike | null; objective: string | null },
  ctx: {
    /** The row's AD SET name, when the table isn't the ad set's own page. */
    campaignName?: string | null;
    /** The row's creative name, when the table isn't the creative's own page. */
    creativeName?: string | null;
    /** The CAMPAIGN a whole-campaign rule covers (the rule's own target). */
    parentCampaignName?: string | null;
  } = {},
): string {
  switch (rule.kind) {
    case "campaign_objective":
      return rule.objective ? `Objective ${rule.objective}` : "Ad set objective";
    case "parent_campaign":
      return ctx.parentCampaignName ? `Campaign «${ctx.parentCampaignName}»` : "Its campaign";
    case "campaign":
      return ctx.campaignName ? `Ad set «${ctx.campaignName}»` : "This ad set";
    case "creative":
      return ctx.creativeName ? `Creative «${ctx.creativeName}»` : "This creative";
    default:
      return "An exclusion rule";
  }
}
