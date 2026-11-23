import { describe, expect, it } from "vitest";
import {
  validateRuleTarget,
  ruleDescriptor,
  resolveIncludeExcludedValue,
} from "@/lib/exclusion-rules";

const t = (over: Partial<Parameters<typeof validateRuleTarget>[0]>) => ({
  kind: "campaign_objective" as const,
  objective: null,
  campaignId: null,
  creativeId: null,
  ...over,
});

describe("validateRuleTarget", () => {
  it("accepts exactly the kind-matching target", () => {
    expect(validateRuleTarget(t({ objective: "Sales" }))).toBeNull();
    expect(
      validateRuleTarget(t({ kind: "campaign", campaignId: "id-1" })),
    ).toBeNull();
    expect(
      validateRuleTarget(t({ kind: "creative", creativeId: "id-2" })),
    ).toBeNull();
  });

  it("rejects zero targets and multiple targets", () => {
    expect(validateRuleTarget(t({}))).toMatch(/exactly one target/);
    expect(
      validateRuleTarget(t({ objective: "Sales", campaignId: "id-1" })),
    ).toMatch(/exactly one target/);
  });

  it("rejects a target on the wrong column for the kind", () => {
    expect(validateRuleTarget(t({ campaignId: "id-1" }))).toBeTruthy(); // objective kind, campaign set
    expect(
      validateRuleTarget(t({ kind: "campaign", creativeId: "id-2" })),
    ).toBeTruthy();
    expect(
      validateRuleTarget(t({ kind: "creative", objective: "Sales" })),
    ).toBeTruthy();
  });
});

describe("the whole-campaign kind (2026-11)", () => {
  it("accepts a campaign target, and only a campaign target", () => {
    expect(
      validateRuleTarget(t({ kind: "parent_campaign", parentCampaignId: "p-1" })),
    ).toBeNull();
    // Missing its own target; or the AD SET column set instead.
    expect(validateRuleTarget(t({ kind: "parent_campaign" }))).toMatch(/exactly one target/);
    expect(
      validateRuleTarget(t({ kind: "parent_campaign", campaignId: "id-1" })),
    ).toMatch(/needs a campaign/);
    // A campaign target on another kind is a second target, or the wrong one.
    expect(
      validateRuleTarget(t({ kind: "campaign", campaignId: "id-1", parentCampaignId: "p-1" })),
    ).toMatch(/exactly one target/);
    expect(
      validateRuleTarget(t({ kind: "campaign", parentCampaignId: "p-1" })),
    ).toMatch(/needs an ad set/);
  });

  it("a target that predates the kind (no parentCampaignId at all) still validates", () => {
    expect(
      validateRuleTarget({ kind: "campaign", objective: null, campaignId: "id-1", creativeId: null }),
    ).toBeNull();
  });

  it("is named 'campaign' — the ad set keeps 'ad set'", () => {
    expect(
      ruleDescriptor(t({ kind: "parent_campaign", parentCampaignId: "p-1" }), "Ramadan Sale"),
    ).toBe("campaign “Ramadan Sale”");
    expect(ruleDescriptor(t({ kind: "parent_campaign", parentCampaignId: "p-1" }))).toBe(
      "campaign “p-1”",
    );
  });
});

describe("ruleDescriptor", () => {
  it("names each kind, preferring the resolved label", () => {
    expect(ruleDescriptor(t({ objective: "Sales" }))).toBe("objective: Sales");
    expect(
      ruleDescriptor(t({ kind: "campaign", campaignId: "id-1" }), "Camp ➤ Broad (IG)"),
    ).toBe("ad set “Camp ➤ Broad (IG)”");
    expect(
      ruleDescriptor(t({ kind: "creative", creativeId: "id-2" }), "URJ_VID_001"),
    ).toBe("creative “URJ_VID_001”");
  });
});

describe("resolveIncludeExcludedValue — URL > saved pref > hidden", () => {
  it("explicit URL param always wins, both directions", () => {
    expect(resolveIncludeExcludedValue("1", false)).toBe(true);
    expect(resolveIncludeExcludedValue("1", null)).toBe(true);
    expect(resolveIncludeExcludedValue("0", true)).toBe(false);
  });
  it("absent param falls back to the saved preference", () => {
    expect(resolveIncludeExcludedValue(undefined, true)).toBe(true);
    expect(resolveIncludeExcludedValue(null, false)).toBe(false);
  });
  it("no param, no preference → hidden (the safe default)", () => {
    expect(resolveIncludeExcludedValue(undefined, null)).toBe(false);
  });
  it("junk param values fall through to the preference", () => {
    expect(resolveIncludeExcludedValue("yes", true)).toBe(true);
    expect(resolveIncludeExcludedValue("", null)).toBe(false);
  });
});

describe("notification titles isolate the rule's target name (W3-5)", () => {
  it("wraps a campaign or creative name in FSI…PDI; the audit descriptor stays plain", async () => {
    const { ruleTitleDescriptor, ruleDescriptor } = await import("@/lib/exclusion-rules");
    const t = { kind: "campaign" as const, objective: null, campaignId: "c1", creativeId: null };
    expect(ruleTitleDescriptor(t, "حملة الصيف")).toBe("ad set “\u2068حملة الصيف\u2069”");
    expect(ruleDescriptor(t, "حملة الصيف")).toBe("ad set “حملة الصيف”");
    expect(
      ruleTitleDescriptor(
        { kind: "campaign_objective", objective: "Sales", campaignId: null, creativeId: null },
        null,
      ),
    ).toBe("objective: Sales");
  });
});
