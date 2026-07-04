import { describe, expect, it } from "vitest";
import { buildCampaignName, parseCampaignName } from "@/lib/campaign";

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
