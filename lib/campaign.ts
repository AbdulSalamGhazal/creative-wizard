/**
 * Campaign objectives — the single source of truth for both the DB enum
 * (db/schema.ts re-exports this as campaignObjectiveEnum) and the create-form
 * dropdown. Client-safe (this module pulls in no server code), so the UI can
 * import it without bundling the schema. Keep "Sales" first — it's the default.
 */
export const CAMPAIGN_OBJECTIVES = [
  "Sales",
  "Prospecting",
  "Retargeting",
  "Reach&Freq",
  "Traffic",
  "Video Views",
] as const;

/**
 * Instagram and Facebook were split out of a single "Meta" export, so the exact
 * same `Campaign ➤ Adset` can legitimately appear on both. To keep them
 * distinct everywhere `campaign_name` is stored, shown, or filtered, we append
 * a short platform tag to their stored campaign name — e.g.
 * `Holiday ➤ Broad (IG)` vs `Holiday ➤ Broad (FB)`. Every other platform is
 * left untagged. (Short tags, not the full label, keep the stored name compact.)
 *
 * This is the single source of truth for the stored `campaign_name` format —
 * the CSV pipeline (uploads) and the seed both build through it. Changing a tag
 * here also requires migrating the stored `campaign_name`s + the `campaigns`
 * registry so uploads keep matching byte-for-byte.
 */
const PLATFORM_TAG: Record<string, string> = {
  instagram: "IG",
  facebook: "FB",
};

export function buildCampaignName(
  campaign: string,
  adset: string,
  platform: string,
): string {
  const base = [campaign, adset]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
    .join(" ➤ ");
  const tag = PLATFORM_TAG[platform];
  if (base && tag) {
    return `${base} (${tag})`;
  }
  return base;
}

/**
 * Inverse of buildCampaignName — split a STORED campaign name back into its
 * Campaign + Ad Set parts for the edit form. Strips the IG/FB platform tag
 * (so the field doesn't show "(IG)"), then splits on the ➤ separator. The
 * first segment is the campaign; anything after is the ad set.
 * `buildCampaignName(parseCampaignName(name, p).campaign, .adset, p)` === name.
 */
export function parseCampaignName(
  stored: string,
  platform: string,
): { campaign: string; adset: string } {
  let base = stored;
  const tag = PLATFORM_TAG[platform];
  if (tag && base.endsWith(` (${tag})`)) {
    base = base.slice(0, -` (${tag})`.length);
  }
  const parts = base.split(" ➤ ");
  return { campaign: parts[0] ?? "", adset: parts.slice(1).join(" ➤ ") };
}
