import { describe, expect, it } from "vitest";
import { exclusionRuleLabel } from "./exclusion-rule-label";

describe("exclusionRuleLabel", () => {
  it("names an objective rule by its objective", () => {
    expect(exclusionRuleLabel({ kind: "campaign_objective", objective: "awareness" })).toBe(
      "Objective awareness",
    );
  });

  it("names a campaign / creative rule by the row's target when known", () => {
    expect(
      exclusionRuleLabel({ kind: "campaign", objective: null }, { campaignName: "Launch ➤ Broad" }),
    ).toBe("Ad set «Launch ➤ Broad»");
    expect(
      exclusionRuleLabel({ kind: "creative", objective: null }, { creativeName: "Hook 07" }),
    ).toBe("Creative «Hook 07»");
  });

  it("names a whole-campaign rule by the campaign — never as an ad set", () => {
    expect(
      exclusionRuleLabel(
        { kind: "parent_campaign", objective: null },
        { parentCampaignName: "Launch", campaignName: "Launch ➤ Broad" },
      ),
    ).toBe("Campaign «Launch»");
    // The ad set's own page knows no campaign name to pass.
    expect(exclusionRuleLabel({ kind: "parent_campaign", objective: null })).toBe("Its campaign");
  });

  it("falls back to the page's own entity, then to the kind", () => {
    expect(exclusionRuleLabel({ kind: "campaign", objective: null })).toBe("This ad set");
    expect(exclusionRuleLabel({ kind: "creative", objective: null })).toBe("This creative");
    expect(exclusionRuleLabel({ kind: null, objective: null })).toBe("An exclusion rule");
  });
});
