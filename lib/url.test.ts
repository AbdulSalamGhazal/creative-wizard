import { describe, expect, it } from "vitest";
import { safeDecodeURIComponent, safeInternalPath } from "@/lib/url";

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

describe("safeInternalPath", () => {
  it("passes a normal same-origin path through", () => {
    expect(safeInternalPath("/summary")).toBe("/summary");
    expect(safeInternalPath("/creatives?view=table")).toBe("/creatives?view=table");
  });

  it("falls back for off-origin / protocol-relative / backslash targets", () => {
    expect(safeInternalPath("https://evil.com")).toBe("/");
    expect(safeInternalPath("//evil.com")).toBe("/");
    expect(safeInternalPath("/\\evil.com")).toBe("/");
    expect(safeInternalPath("not-a-path")).toBe("/");
    expect(safeInternalPath(null)).toBe("/");
    expect(safeInternalPath(undefined)).toBe("/");
    expect(safeInternalPath("", "/signin")).toBe("/signin");
  });

  it("rejects paths with ASCII control chars (browsers strip them → //evil.com)", () => {
    // "/%09/evil.com" decodes to "/\t/evil.com"; the browser strips the tab and
    // re-forms "//evil.com" (protocol-relative → off-site).
    expect(safeInternalPath("/\t/evil.com")).toBe("/");
    expect(safeInternalPath("/\n/evil.com")).toBe("/");
    expect(safeInternalPath("/\r//evil.com")).toBe("/");
    // A space (0x20) is NOT a control char — an ordinary path passes.
    expect(safeInternalPath("/foo bar")).toBe("/foo bar");
  });
});
