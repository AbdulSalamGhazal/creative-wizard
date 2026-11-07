/**
 * The words for "which rule excluded this record" (R-007). Rules carry no
 * name of their own — a rule IS its target — so a record names it by kind
 * and target: "Objective awareness", "Campaign «Launch ➤ Broad»", "This
 * creative". A records table already knows the row's campaign / creative, so
 * the caller passes what it has; a target it can't name falls back to the kind.
 */
export type ExclusionRuleKindLike = "campaign_objective" | "campaign" | "creative";

export function exclusionRuleLabel(
  rule: { kind: ExclusionRuleKindLike | null; objective: string | null },
  ctx: {
    /** The row's campaign name, when the table isn't the campaign's own page. */
    campaignName?: string | null;
    /** The row's creative name, when the table isn't the creative's own page. */
    creativeName?: string | null;
  } = {},
): string {
  switch (rule.kind) {
    case "campaign_objective":
      return rule.objective ? `Objective ${rule.objective}` : "Campaign objective";
    case "campaign":
      return ctx.campaignName ? `Campaign «${ctx.campaignName}»` : "This campaign";
    case "creative":
      return ctx.creativeName ? `Creative «${ctx.creativeName}»` : "This creative";
    default:
      return "An exclusion rule";
  }
}
