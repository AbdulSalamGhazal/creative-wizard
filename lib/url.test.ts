import { describe, expect, it } from "vitest";
import { safeDecodeURIComponent } from "@/lib/url";

describe("safeDecodeURIComponent", () => {
  it("decodes a normal encoded segment", () => {
    expect(safeDecodeURIComponent("50%25%20off")).toBe("50% off");
  });

  it("round-trips special characters built by encodeURIComponent", () => {
    const names = [
      'Slides Saeed "why pay more?"',
      "Image Umar tabby&tamara #5",
      "Video Unboxing Mostafa - V2",
      "Campaign ➤ Adset (Instagram)",
      "100% nat/ural #thing?",
    ];
    for (const name of names) {
      expect(safeDecodeURIComponent(encodeURIComponent(name))).toBe(name);
    }
  });

  it("returns the raw value instead of throwing on a malformed escape", () => {
    // A bare % or truncated escape would make decodeURIComponent throw.
    expect(safeDecodeURIComponent("50%off")).toBe("50%off");
    expect(safeDecodeURIComponent("%")).toBe("%");
    expect(safeDecodeURIComponent("%E0%A4%A")).toBe("%E0%A4%A");
  });
});
