import { z } from "zod";
import { exclusionRuleKindEnum } from "@/lib/enums";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import type { ExclusionRuleTarget } from "@/lib/exclusion-rules";

// docs/prd.md §5.5: reason is required and capped at 200 chars.
export const excludeSchema = z.object({
  reason: z.string().min(1).max(200),
});


/** A performance record's id (`excludeRecord` / `includeRecord`). Moved here 2026-11-19. */
export const recordIdSchema = z.coerce.number().int().positive();

/**
 * An exclusion rule's target (`app/actions/exclusion-rules.ts`). Moved here
 * verbatim 2026-11-19; `validateRuleTarget` still checks the combination and
 * the FKs against the active brand after this shape check.
 */
export const exclusionRuleTargetSchema = z
  .object({
    kind: z.enum(exclusionRuleKindEnum),
    objective: z.enum(CAMPAIGN_OBJECTIVES).nullish(),
    campaignId: z.string().uuid().nullish(),
    creativeId: z.string().uuid().nullish(),
    /** A whole CAMPAIGN (`parent_campaigns`); `campaignId` is one ad set. */
    parentCampaignId: z.string().uuid().nullish(),
  })
  .transform(
    (t): ExclusionRuleTarget => ({
      kind: t.kind,
      objective: t.objective ?? null,
      campaignId: t.campaignId ?? null,
      creativeId: t.creativeId ?? null,
      parentCampaignId: t.parentCampaignId ?? null,
    }),
  );

export const exclusionRuleCreateSchema = z.object({
  target: exclusionRuleTargetSchema,
  note: z.string().trim().max(200).optional(),
});

/** Switch a rule on or off. */
export const exclusionRuleToggleSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});
