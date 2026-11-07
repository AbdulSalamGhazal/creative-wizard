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
    ).toBe("Campaign «Launch ➤ Broad»");
    expect(
      exclusionRuleLabel({ kind: "creative", objective: null }, { creativeName: "Hook 07" }),
    ).toBe("Creative «Hook 07»");
  });

  it("falls back to the page's own entity, then to the kind", () => {
    expect(exclusionRuleLabel({ kind: "campaign", objective: null })).toBe("This campaign");
    expect(exclusionRuleLabel({ kind: "creative", objective: null })).toBe("This creative");
    expect(exclusionRuleLabel({ kind: null, objective: null })).toBe("An exclusion rule");
  });
});
