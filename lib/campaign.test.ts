import { describe, expect, it } from "vitest";
import {
  AD_NETWORKS,
  adNetwork,
  adSetLabel,
  adSetPath,
  buildCampaignName,
  campaignNameHasSeparator,
  campaignPath,
  CAMPAIGN_OBJECTIVES,
  isAdNetwork,
  networkPlatforms,
  parentKey,
  parentOfBuiltName,
  parseCampaignName,
} from "@/lib/campaign";
import { ALL_PLATFORMS } from "@/lib/palette";

/**
 * buildCampaignName is the single source of truth for the stored campaign-name
 * format: `Campaign ➤ Adset`, with a short platform tag for the two Meta
 * channels — ` (IG)` / ` (FB)` — so the same Meta campaign split across the
 * two stays distinct. The CSV pipeline, the create/edit actions, and the seed
 * all build through it; a drift here breaks byte-for-byte upload matching.
 */
describe("buildCampaignName", () => {
  it("joins campaign + adset with the arrow separator", () => {
    expect(buildCampaignName("Holiday", "Broad", "tiktok")).toBe("Holiday ➤ Broad");
  });

  it("appends (IG) for instagram and (FB) for facebook", () => {
    expect(buildCampaignName("Holiday", "Broad", "instagram")).toBe(
      "Holiday ➤ Broad (IG)",
    );
    expect(buildCampaignName("Holiday", "Broad", "facebook")).toBe(
      "Holiday ➤ Broad (FB)",
    );
  });

  it("leaves tiktok and snapchat untagged", () => {
    expect(buildCampaignName("Holiday", "Broad", "snapchat")).toBe("Holiday ➤ Broad");
    expect(buildCampaignName("Holiday", "Broad", "tiktok")).toBe("Holiday ➤ Broad");
  });

  it("omits the arrow when the adset is empty (but still tags IG/FB)", () => {
    expect(buildCampaignName("Holiday", "", "tiktok")).toBe("Holiday");
    expect(buildCampaignName("Holiday", "", "instagram")).toBe("Holiday (IG)");
  });

  it("trims each part and drops empty segments", () => {
    expect(buildCampaignName("  Holiday  ", "  Broad ", "tiktok")).toBe(
      "Holiday ➤ Broad",
    );
    expect(buildCampaignName("   ", "Broad", "tiktok")).toBe("Broad");
  });

  it("returns an empty string (no dangling tag) when everything is empty", () => {
    expect(buildCampaignName("", "", "instagram")).toBe("");
    expect(buildCampaignName("  ", "  ", "facebook")).toBe("");
  });
});

describe("parseCampaignName (inverse)", () => {
  it("splits a stored name back into campaign + adset, stripping the platform tag", () => {
    expect(parseCampaignName("Holiday ➤ Broad (IG)", "instagram")).toEqual({
      campaign: "Holiday",
      adset: "Broad",
    });
    expect(parseCampaignName("Holiday ➤ Broad", "tiktok")).toEqual({
      campaign: "Holiday",
      adset: "Broad",
    });
  });

  it("only strips the tag matching the platform", () => {
    // A tiktok campaign literally named "... (IG)" keeps its suffix.
    expect(parseCampaignName("Holiday ➤ Broad (IG)", "tiktok")).toEqual({
      campaign: "Holiday",
      adset: "Broad (IG)",
    });
  });

  it("round-trips: build(parse(name)) === name for every platform", () => {
    const cases: Array<[string, string]> = [
      ["Holiday ➤ Broad (IG)", "instagram"],
      ["Holiday ➤ Broad (FB)", "facebook"],
      ["Sal_U3_11-Feb ➤ Prs_24-Jun", "tiktok"],
      ["Solo-Campaign", "snapchat"],
      ["Solo-Campaign (IG)", "instagram"],
    ];
    for (const [stored, platform] of cases) {
      const { campaign, adset } = parseCampaignName(stored, platform);
      expect(buildCampaignName(campaign, adset, platform)).toBe(stored);
    }
  });
});

describe("CAMPAIGN_OBJECTIVES", () => {
  it("is pinned to exactly the six current values", () => {
    // Reach&Freq / Traffic / Video Views were merged into "Awareness" (2026-09)
    // and must never be reintroduced; "Activation" and "Special Case" were
    // added new. Order matters only for "Sales" (the default, kept first).
    expect([...CAMPAIGN_OBJECTIVES]).toEqual([
      "Sales",
      "Prospecting",
      "Retargeting",
      "Awareness",
      "Activation",
      "Special Case",
    ]);
  });
});

/**
 * TWO LEVELS (2026-11): a CAMPAIGN lives on one ad NETWORK, and its ad sets'
 * stored names carry its name. These helpers are what keep the registry, the
 * upload pipeline and the backfill reading a stored name the same way.
 */
describe("ad networks — the level a campaign lives on", () => {
  it("folds Instagram and Facebook into Meta; every other platform is its own network", () => {
    expect(adNetwork("instagram")).toBe("meta");
    expect(adNetwork("facebook")).toBe("meta");
    expect(adNetwork("tiktok")).toBe("tiktok");
    expect(adNetwork("snapchat")).toBe("snapchat");
    expect(adNetwork("google")).toBe("google");
    expect(adNetwork("not-a-platform")).toBeNull();
  });

  it("derives the network list from the platforms — every platform has one", () => {
    expect([...AD_NETWORKS]).toEqual(["meta", "tiktok", "snapchat", "google"]);
    for (const p of ALL_PLATFORMS) {
      const network = adNetwork(p)!;
      expect(networkPlatforms(network)).toContain(p);
      expect(isAdNetwork(network)).toBe(true);
    }
    expect(networkPlatforms("meta")).toEqual(["instagram", "facebook"]);
    expect(isAdNetwork("instagram")).toBe(false);
  });
});

describe("the campaign of a built ad-set name", () => {
  it("is the network of the platform and the part before the first separator", () => {
    expect(parentOfBuiltName("Holiday ➤ Broad (IG)", "instagram")).toEqual({
      network: "meta",
      campaign: "Holiday",
      adset: "Broad",
    });
    // A later separator belongs to the ad set.
    expect(parentOfBuiltName("Deep ➤ One ➤ Two", "tiktok")).toEqual({
      network: "tiktok",
      campaign: "Deep",
      adset: "One ➤ Two",
    });
    expect(parentOfBuiltName("Solo", "not-a-platform")).toBeNull();
  });

  it("round-trips for every platform: parent + ad set rebuild the stored name", () => {
    const campaigns = ["Holiday", "Sal_U3_11-Feb", "مسباح | Sales | 15 Feb", "A (IG)"];
    const adsets = ["Broad", "Age 18-45 (copy)", "One ➤ Two", "30 June | Soft Exc.", ""];
    for (const platform of ALL_PLATFORMS) {
      for (const campaign of campaigns) {
        for (const adset of adsets) {
          const built = buildCampaignName(campaign, adset, platform);
          expect(parentOfBuiltName(built, platform)).toEqual({
            network: adNetwork(platform),
            campaign,
            adset,
          });
        }
      }
    }
  });

  it("a campaign name may not contain the separator", () => {
    expect(campaignNameHasSeparator("A ➤ B")).toBe(true);
    expect(campaignNameHasSeparator("A➤B")).toBe(true);
    expect(campaignNameHasSeparator("A | B > C")).toBe(false);
  });

  it("keys a campaign by network + name", () => {
    expect(parentKey("meta", "Holiday")).not.toBe(parentKey("tiktok", "Holiday"));
    expect(parentKey("meta", "Holiday")).toBe(parentKey("meta", "Holiday"));
  });
});

describe("addresses and labels", () => {
  it("an ad set is addressed by its stored name, a campaign by network + name", () => {
    expect(adSetPath("Holiday ➤ Broad (IG)")).toBe(
      `/ad-sets/${encodeURIComponent("Holiday ➤ Broad (IG)")}`,
    );
    expect(campaignPath("meta", "Holiday Sale")).toBe("/campaigns/meta/Holiday%20Sale");
  });

  it("labels an ad set inside its campaign with the platform tag kept", () => {
    expect(adSetLabel("Holiday ➤ Broad (IG)")).toBe("Broad (IG)");
    expect(adSetLabel("Deep ➤ One ➤ Two")).toBe("One ➤ Two");
    // No ad-set part: the stored name is all there is.
    expect(adSetLabel("Solo (FB)")).toBe("Solo (FB)");
  });
});
