import { describe, expect, it } from "vitest";
import { signinHref } from "@/lib/signin-redirect";

describe("signinHref — the way back survives the sign-in", () => {
  it("carries the path and its query as ?next=", () => {
    expect(signinHref("/library?tab=products")).toBe("/signin?next=%2Flibrary%3Ftab%3Dproducts");
  });

  it("the home page, or nothing known, is a bare /signin", () => {
    expect(signinHref("/")).toBe("/signin");
    expect(signinHref(null)).toBe("/signin");
    expect(signinHref(undefined)).toBe("/signin");
  });
});
