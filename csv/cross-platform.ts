/**
 * Cross-platform campaign-name guard (error code E060).
 *
 * A campaign name must belong to a SINGLE platform. The app keys a campaign by
 * its name alone (the /campaigns/[name] route, the campaigns table grouping,
 * every campaign-detail query) — so the same name appearing on two platforms is
 * silently treated as one campaign and its metrics get merged. We reject such an
 * upload at validate time with a clear, actionable message instead.
 *
 * This is the PURE part (so it's unit-tested); the route supplies the existing
 * (name, platform) pairs via a DB query.
 */

import { PLATFORM_LABEL } from "@/lib/palette";
import type { ValidationError } from "@/csv/errors";

export interface ExistingCampaignPlatform {
  campaignName: string;
  platform: string;
}

const label = (p: string): string =>
  PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] ?? p;

/**
 * @param uploadPlatform   the platform this file is being uploaded for
 * @param fileCampaignNames distinct campaign names present in the file
 * @param existingOnOther   (name, platform) pairs already in the DB on OTHER
 *                          platforms (the route scopes the query by account +
 *                          active batches + platform != uploadPlatform)
 * @returns one E060 error per file campaign name that already lives on another
 *          platform (empty array when there are no collisions)
 */
export function campaignPlatformCollisions(
  uploadPlatform: string,
  fileCampaignNames: string[],
  existingOnOther: ExistingCampaignPlatform[],
): ValidationError[] {
  const otherPlatformsByName = new Map<string, Set<string>>();
  for (const e of existingOnOther) {
    if (e.platform === uploadPlatform) continue; // defensive — shouldn't happen
    const set = otherPlatformsByName.get(e.campaignName) ?? new Set<string>();
    set.add(e.platform);
    otherPlatformsByName.set(e.campaignName, set);
  }

  const wanted = new Set(fileCampaignNames);
  const here = label(uploadPlatform);
  const errors: ValidationError[] = [];
  for (const [name, platforms] of otherPlatformsByName) {
    if (!wanted.has(name)) continue;
    const others = [...platforms].sort().map(label).join(", ");
    errors.push({
      code: "E060",
      severity: "ERROR",
      field: "campaign_name",
      value: name,
      message:
        `Campaign “${name}” already exists on ${others}, but this file is for ${here}. ` +
        `A campaign name must belong to a single platform — the app treats the same name as ` +
        `one campaign and would merge the two. Rename this campaign for ${here} ` +
        `(e.g. add the platform to the name) and upload again.`,
    });
  }
  // Stable order for predictable display / tests.
  return errors.sort((a, b) => (a.value ?? "").localeCompare(b.value ?? ""));
}
