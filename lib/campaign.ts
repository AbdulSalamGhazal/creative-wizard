import { ALL_PLATFORMS, type PlatformKey } from "@/lib/palette";

/**
 * TWO LEVELS (2026-11). The UI's **Campaign** is a `parent_campaigns` row —
 * `parentCampaign` in code; the UI's **Ad set** is a `campaigns` row — the
 * object this module has always called "campaign", whose stored `name` is the
 * built `Campaign ➤ Ad set (IG|FB)` string. The old identifiers stay (they are
 * stored vocabulary: comment anchors, audit actions, rule kinds), so read
 * `campaign` in code as "ad set". → docs/decisions/campaigns.md
 */

/**
 * Campaign objectives — the single source of truth for both the DB enum
 * (db/schema.ts re-exports this as campaignObjectiveEnum) and the create-form
 * dropdown. Client-safe (this module pulls in no server code), so the UI can
 * import it without bundling the schema. Keep "Sales" first — it's the default.
 *
 * 2026-09 merge: "Reach&Freq" / "Traffic" / "Video Views" were RETIRED and all
 * existing campaigns carrying them renamed to "Awareness" (migration 0034);
 * "Activation" was added new. Do not reintroduce the removed values.
 */
export const CAMPAIGN_OBJECTIVES = [
  "Sales",
  "Prospecting",
  "Retargeting",
  "Awareness",
  "Activation",
  "Special Case",
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

/**
 * An AD SET's platform is LOCKED once it has records (D9, 2026-10-23): each
 * record carries its own platform, so re-tagging the ad set made the two
 * disagree and the old name's next upload hit E061. The edit dialog shows the
 * tip; the action refuses with the sentence.
 */
export const CAMPAIGN_PLATFORM_LOCKED =
  "This ad set already has records, so its platform can't change.";
export const CAMPAIGN_PLATFORM_LOCKED_TIP =
  "Locked — this ad set already has records, and they were uploaded for this platform.";


/** The separator between the campaign and the ad set in a stored name. */
export const CAMPAIGN_SEPARATOR = " ➤ ";

/**
 * The AD NETWORK a platform belongs to — the level a Campaign lives on.
 * Instagram and Facebook are two platforms of ONE Meta campaign (it is one
 * campaign in Ads Manager, split by placement); every other platform is its
 * own network. Typed by `PlatformKey`, so a new platform fails to compile
 * here until it is given a network.
 */
const NETWORK_OF = {
  instagram: "meta",
  facebook: "meta",
  tiktok: "tiktok",
  snapchat: "snapchat",
  google: "google",
} as const satisfies Record<PlatformKey, string>;

export type AdNetwork = (typeof NETWORK_OF)[PlatformKey];

/** Every network, in platform order — DERIVED from the platform list. */
export const AD_NETWORKS = [
  ...new Set(ALL_PLATFORMS.map((p) => NETWORK_OF[p])),
] as unknown as readonly [AdNetwork, ...AdNetwork[]];

export const AD_NETWORK_LABEL: Record<AdNetwork, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
};

export function isAdNetwork(v: string): v is AdNetwork {
  return (AD_NETWORKS as readonly string[]).includes(v);
}

/** The network of a platform; null for a string that isn't a platform. */
export function adNetwork(platform: string): AdNetwork | null {
  return (NETWORK_OF as Record<string, AdNetwork | undefined>)[platform] ?? null;
}

/** The platforms an ad set of this network can run on (Meta → IG + FB). */
export function networkPlatforms(network: AdNetwork): PlatformKey[] {
  return ALL_PLATFORMS.filter((p) => NETWORK_OF[p] === network);
}

/**
 * A Campaign's name may never contain the separator: `A ➤ B` + ad set `C`
 * would build `A ➤ B ➤ C`, which reads back as campaign `A`.
 */
export function campaignNameHasSeparator(name: string): boolean {
  return name.includes(CAMPAIGN_SEPARATOR.trim());
}

/**
 * Which Campaign a built ad-set name belongs to: the network of its platform
 * and the campaign part of the name. ALWAYS derived from the built name —
 * never from a raw cell — so uploads, the backfill and the forms agree.
 */
export function parentOfBuiltName(
  built: string,
  platform: string,
): { network: AdNetwork; campaign: string; adset: string } | null {
  const network = adNetwork(platform);
  if (!network) return null;
  const { campaign, adset } = parseCampaignName(built, platform);
  return { network, campaign, adset };
}

/** Map key for a Campaign: network + name, joined by U+0001 (greps fine). */
export function parentKey(network: string, name: string): string {
  return `${network}\u0001${name}`;
}

/** An AD SET's page — addressed by its full stored name. */
export function adSetPath(storedName: string): string {
  return `/ad-sets/${encodeURIComponent(storedName)}`;
}

/** A CAMPAIGN's page — its network, then its name (unique together). */
export function campaignPath(network: string, name: string): string {
  return `/campaigns/${encodeURIComponent(network)}/${encodeURIComponent(name)}`;
}

/**
 * An ad set's label INSIDE its own campaign: its stored name without the
 * campaign prefix, the platform tag kept — `Broad (IG)` — which is what tells
 * the Instagram and Facebook rows of one Meta ad set apart.
 */
export function adSetLabel(storedName: string): string {
  const at = storedName.indexOf(CAMPAIGN_SEPARATOR);
  return at >= 0 ? storedName.slice(at + CAMPAIGN_SEPARATOR.length) : storedName;
}
