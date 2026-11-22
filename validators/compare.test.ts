import { describe, expect, it } from "vitest";
import {
  OWN_LANDING_PAGE,
  compareFiltersSchema,
  sideIsEmpty,
  sideLandingFilter,
} from "@/validators/compare";

describe("Compare's Landing page level", () => {
  it("reads each side's landing pages from its own CSV param", () => {
    const v = compareFiltersSchema.parse({ aLandingPages: "lp1,own,lp1", cLandingPages: "lp2" });
    expect(v.sides.map((s) => s.landingPages)).toEqual([["lp1", "own"], [], ["lp2"]]);
  });

  it("a landing page alone makes a side non-empty (and keeps side C)", () => {
    const v = compareFiltersSchema.parse({ cLandingPages: "lp2" });
    expect(v.sides).toHaveLength(3);
    expect(sideIsEmpty(v.sides[2]!)).toBe(false);
  });

  it("splits \"Product page\" from registered ids for KpiFilters", () => {
    expect(sideLandingFilter([])).toEqual({ landingPageIds: undefined, ownLandingPage: undefined });
    expect(sideLandingFilter(["lp1"])).toEqual({ landingPageIds: ["lp1"], ownLandingPage: undefined });
    expect(sideLandingFilter([OWN_LANDING_PAGE])).toEqual({ landingPageIds: undefined, ownLandingPage: true });
    expect(sideLandingFilter(["lp1", OWN_LANDING_PAGE])).toEqual({ landingPageIds: ["lp1"], ownLandingPage: true });
  });
});
