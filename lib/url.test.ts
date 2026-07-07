import { describe, expect, it } from "vitest";
import {
  safeDecodeURIComponent,
  safeInternalPath,
  withDateRange,
} from "@/lib/url";

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

describe("withDateRange", () => {
  const base = "/campaigns/Holiday%20%E2%9E%A4%20Broad";

  it("appends from/to when both are present", () => {
    expect(withDateRange(base, "2026-01-01", "2026-07-04")).toBe(
      `${base}?from=2026-01-01&to=2026-07-04`,
    );
  });

  it("uses & when the href already has a query string", () => {
    expect(withDateRange("/creatives/x?view=table", "2026-01-01", "2026-02-01")).toBe(
      "/creatives/x?view=table&from=2026-01-01&to=2026-02-01",
    );
  });

  it("is a no-op when either end is missing (Lifetime / saved-pref)", () => {
    expect(withDateRange(base, null, null)).toBe(base);
    expect(withDateRange(base, "2026-01-01", null)).toBe(base);
    expect(withDateRange(base, null, "2026-07-04")).toBe(base);
    expect(withDateRange(base, undefined, undefined)).toBe(base);
    expect(withDateRange(base, "", "")).toBe(base);
  });

  it("encodes the date values", () => {
    // Defensive: values are trusted ISO dates, but the helper must not emit raw
    // delimiters if ever handed something odd.
    expect(withDateRange("/x", "a&b", "c")).toBe("/x?from=a%26b&to=c");
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
