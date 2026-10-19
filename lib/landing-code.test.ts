import { describe, expect, it } from "vitest";
import {
  hasLandingMarker,
  isValidLandingCode,
  splitLandingCode,
  withLandingCode,
} from "@/lib/landing-code";

describe("splitLandingCode", () => {
  it("returns the whole cell as the name when there is no marker", () => {
    expect(splitLandingCode("Promo_01")).toEqual({ ok: true, name: "Promo_01", code: null });
  });

  it("splits `Name @code` at the marker", () => {
    expect(splitLandingCode("Promo 01 @ramadan-2_b")).toEqual({
      ok: true,
      name: "Promo 01",
      code: "ramadan-2_b",
    });
  });

  it("does not split an @ without the space before it", () => {
    expect(splitLandingCode("Promo_01@lp2")).toEqual({ ok: true, name: "Promo_01@lp2", code: null });
  });

  it.each([
    "Promo_01 @",
    "Promo_01 @ lp2",
    "Promo_01 @lp2 @lp3",
    "Promo_01  @lp2",
    " @lp2",
    "Promo_01 @lp.2",
    `Promo_01 @${"x".repeat(65)}`,
  ])("refuses the malformed %j", (cell) => {
    expect(splitLandingCode(cell)).toEqual({ ok: false });
  });

  it("round-trips through withLandingCode", () => {
    expect(withLandingCode("Promo_01", "lp2")).toBe("Promo_01 @lp2");
    expect(withLandingCode("Promo_01", null)).toBe("Promo_01");
  });
});

describe("isValidLandingCode / hasLandingMarker", () => {
  it("accepts letters, digits, - and _ up to 64 characters", () => {
    expect(isValidLandingCode("LP-2_a")).toBe(true);
    expect(isValidLandingCode("x".repeat(64))).toBe(true);
    expect(isValidLandingCode("")).toBe(false);
    expect(isValidLandingCode("lp 2")).toBe(false);
    expect(isValidLandingCode("عرض")).toBe(false);
  });

  it("flags a creative name an upload would split", () => {
    expect(hasLandingMarker("Summer @sale")).toBe(true);
    expect(hasLandingMarker("Summer@sale")).toBe(false);
  });
});
