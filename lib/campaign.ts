import { PLATFORM_LABEL } from "@/lib/palette";

/**
 * Instagram and Facebook were split out of a single "Meta" export, so the exact
 * same `Campaign ➤ Adset` can legitimately appear on both. To keep them
 * distinct everywhere `campaign_name` is stored, shown, or filtered, we append
 * the platform to their stored campaign name — e.g. `Holiday ➤ Broad (Instagram)`
 * vs `Holiday ➤ Broad (Facebook)`. Every other platform is left untagged.
 *
 * This is the single source of truth for the stored `campaign_name` format —
 * the CSV pipeline (uploads) and the seed both build through it.
 */
const PLATFORM_TAGGED = new Set<string>(["instagram", "facebook"]);

export function buildCampaignName(
  campaign: string,
  adset: string,
  platform: string,
): string {
  const base = [campaign, adset]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
    .join(" ➤ ");
  if (base && PLATFORM_TAGGED.has(platform)) {
    const label =
      PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL] ?? platform;
    return `${base} (${label})`;
  }
  return base;
}
