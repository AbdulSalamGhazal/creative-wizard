import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BRAND_COLORS, brandColor, brandColorKey, brandInitial, isBrandColorKey } from "@/lib/brand-style";
import { brandColorEnum } from "@/lib/enums";
import { containRect } from "@/lib/brand-logo-upload";

describe("brand colours", () => {
  it("every swatch key has a label and a theme token", () => {
    expect(Object.keys(BRAND_COLORS).sort()).toEqual([...brandColorEnum].sort());
    for (const k of brandColorEnum) expect(BRAND_COLORS[k].token).toMatch(/^var\(--series-\d+\)$/);
  });

  it("no swatch is a pacing verdict hue or red (series 1 blue, 4 amber, 8 red)", () => {
    const tokens = Object.values(BRAND_COLORS).map((c) => c.token);
    for (const banned of ["var(--series-1)", "var(--series-4)", "var(--series-8)"]) {
      expect(tokens).not.toContain(banned);
    }
    // …and the verdict hues really are those series in the stylesheet.
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/--series-1: #60a5fa/);
    expect(css).toMatch(/--series-4: #fbbf24/);
  });

  it("a chosen colour wins; an unset or unknown one derives a STABLE default from the id", () => {
    expect(brandColorKey({ id: "a", color: "teal" })).toBe("teal");
    const d = brandColorKey({ id: "00000000-0000-0000-0000-000000000001", color: null });
    expect(brandColorEnum).toContain(d);
    expect(brandColorKey({ id: "00000000-0000-0000-0000-000000000001", color: "nope" })).toBe(d);
    expect(brandColor({ id: "a", color: "pink" })).toBe("var(--series-2)");
    expect(isBrandColorKey("pink")).toBe(true);
    expect(isBrandColorKey("red")).toBe(false);
  });
});

describe("the logo-less mark", () => {
  it("is the first letter or digit of the name", () => {
    expect(brandInitial("mesbah")).toBe("M");
    expect(brandInitial("  9 Lives")).toBe("9");
    expect(brandInitial("«Urjwan»")).toBe("U");
    expect(brandInitial("أرجوان")).toBe("أ");
    expect(brandInitial("")).toBe("?");
  });
});

describe("a logo is fitted, never cropped", () => {
  it("a wide wordmark keeps its full width, centred", () => {
    expect(containRect(400, 100, 128)).toEqual({ dx: 0, dy: 48, dw: 128, dh: 32 });
    expect(containRect(100, 400, 128)).toEqual({ dx: 48, dy: 0, dw: 32, dh: 128 });
  });
  it("a small image is never upscaled", () => {
    expect(containRect(64, 64, 64)).toEqual({ dx: 0, dy: 0, dw: 64, dh: 64 });
  });
});
