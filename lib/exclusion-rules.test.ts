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

describe("ruleDescriptor", () => {
  it("names each kind, preferring the resolved label", () => {
    expect(ruleDescriptor(t({ objective: "Sales" }))).toBe("objective: Sales");
    expect(
      ruleDescriptor(t({ kind: "campaign", campaignId: "id-1" }), "Camp ➤ Broad (IG)"),
    ).toBe("campaign “Camp ➤ Broad (IG)”");
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
