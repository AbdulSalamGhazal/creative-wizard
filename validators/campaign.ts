import { z } from "zod";
import { campaignObjectiveEnum, platformEnum } from "@/db/schema";

/**
 * New-campaign form. The buyer enters the Campaign + Ad Set + Platform; the
 * action runs these through buildCampaignName to produce the EXACT stored
 * `campaign_name`, so a registered campaign matches an uploaded one byte-for-byte.
 */
export const createCampaignSchema = z.object({
  campaign: z.string().trim().min(1, "Campaign name is required").max(400),
  adset: z.string().trim().max(400).optional().default(""),
  platform: z.enum(platformEnum),
  objective: z.enum(campaignObjectiveEnum).default("Sales"),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/** Compare modes for the campaign-diagnosis ROAS bridge. */
export const CAMPAIGN_COMPARE = ["prev", "wow", "mom"] as const;
export type CampaignCompare = (typeof CAMPAIGN_COMPARE)[number];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  from: z
    .string()
    .optional()
    .transform((v) => (v && ISO.test(v) ? v : undefined)),
  to: z
    .string()
    .optional()
    .transform((v) => (v && ISO.test(v) ? v : undefined)),
  // A bad/absent value falls back to "prev" rather than erroring.
  compare: z.enum(CAMPAIGN_COMPARE).catch("prev"),
  includeExcluded: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export interface CampaignDetailParams {
  from?: string;
  to?: string;
  compare: CampaignCompare;
  includeExcluded: boolean;
}

/** Parse the campaign-detail searchParams into a typed, validated object. */
export function parseCampaignDetailParams(sp: {
  from?: string;
  to?: string;
  compare?: string;
  includeExcluded?: string;
}): CampaignDetailParams {
  const r = schema.parse(sp);
  return {
    from: r.from,
    to: r.to,
    compare: r.compare,
    includeExcluded: r.includeExcluded,
  };
}
