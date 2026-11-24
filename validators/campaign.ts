import { z } from "zod";
import { adNetworkEnum, campaignObjectiveEnum, platformEnum } from "@/lib/enums";
import { campaignNameHasSeparator } from "@/lib/campaign";

/**
 * TWO LEVELS (2026-11; lib/campaign.ts). A CAMPAIGN is a `parent_campaigns`
 * row: a name on one ad network. An AD SET is a `campaigns` row under it,
 * whose stored `name` the action builds with `buildCampaignName` so it matches
 * an uploaded row byte-for-byte.
 */

/** A campaign's own name — never the separator (it would read back wrong). */
const parentNameSchema = z
  .string()
  .trim()
  .min(1, "Campaign name is required")
  .max(400)
  .refine((v) => !campaignNameHasSeparator(v), "A campaign name can't contain ➤");

/**
 * One ad set being registered: its name, its objective, and the platforms it
 * runs on. A Meta ad set ticked for Instagram AND Facebook becomes two rows
 * (one per platform), exactly as an upload reports it.
 */
const adSetDraftSchema = z.object({
  name: z.string().trim().min(1, "Ad set name is required").max(400),
  // Required (no silent default) — the form forces a deliberate pick.
  objective: z.enum(campaignObjectiveEnum),
  platforms: z
    .array(z.enum(platformEnum))
    .min(1, "Pick at least one platform")
    .max(platformEnum.length),
});
export type AdSetDraft = z.infer<typeof adSetDraftSchema>;

const adSetDraftsSchema = z
  .array(adSetDraftSchema)
  .min(1, "Add at least one ad set")
  .max(50, "Register at most 50 ad sets at a time");

/** "New campaign": the campaign and its first ad sets, on one screen. */
export const createParentCampaignSchema = z.object({
  name: parentNameSchema,
  network: z.enum(adNetworkEnum),
  adSets: adSetDraftsSchema,
});

/** "Add ad set" on a campaign's page. */
export const addAdSetsSchema = z.object({
  parentId: z.string().uuid(),
  adSets: adSetDraftsSchema,
});

/** Rename a campaign (its ad sets' stored names follow, in the action). */
export const updateParentCampaignSchema = z.object({
  id: z.string().uuid(),
  name: parentNameSchema,
});

/**
 * Edit an AD SET: its own name, platform and objective. The campaign part of
 * the stored name comes from its parent — renaming THAT is the campaign's
 * edit. The ad-set name is REQUIRED, as it is on create (2026-11-24: every
 * row has one since the contract migration).
 */
export const updateCampaignSchema = z.object({
  id: z.string().uuid(),
  adset: z.string().trim().min(1, "Required").max(400),
  platform: z.enum(platformEnum),
  objective: z.enum(campaignObjectiveEnum),
});

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
  includeExcluded: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export interface CampaignDetailParams {
  from?: string;
  to?: string;
  includeExcluded: boolean;
}

/**
 * Parse the detail searchParams (an ad set's page AND a campaign's page —
 * the same three) into a typed, validated object.
 */
export function parseCampaignDetailParams(sp: {
  from?: string;
  to?: string;
  includeExcluded?: string;
}): CampaignDetailParams {
  const r = schema.parse(sp);
  return {
    from: r.from,
    to: r.to,
    includeExcluded: r.includeExcluded,
  };
}
