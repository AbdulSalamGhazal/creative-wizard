import { describe, it, expect } from "vitest";
import {
  decodeRememberedRange,
  encodeRememberedRange,
  LIFETIME_FLOOR,
} from "@/lib/date-presets";

// Fixed "today" so preset math is deterministic. "Last N days" end YESTERDAY.
const TODAY = "2026-06-10";

describe("decodeRememberedRange", () => {
  it("returns null for absent / empty values", () => {
    expect(decodeRememberedRange(undefined, TODAY)).toBeNull();
    expect(decodeRememberedRange(null, TODAY)).toBeNull();
    expect(decodeRememberedRange("", TODAY)).toBeNull();
  });

  it("resolves a preset key as a ROLLING range relative to today", () => {
    expect(decodeRememberedRange("7", TODAY)).toEqual({
      from: "2026-06-03",
      to: "2026-06-09",
    });
    expect(decodeRememberedRange("30", TODAY)).toEqual({
      from: "2026-05-11",
      to: "2026-06-09",
    });
  });

  it("resolves lifetime to floor → today", () => {
    expect(decodeRememberedRange("lifetime", TODAY)).toEqual({
      from: LIFETIME_FLOOR,
      to: TODAY,
    });
  });

  it("parses an explicit custom range", () => {
    expect(
      decodeRememberedRange("custom:2026-01-01..2026-02-15", TODAY),
    ).toEqual({ from: "2026-01-01", to: "2026-02-15" });
  });

  it("rejects malformed custom ranges and unknown keys", () => {
    expect(decodeRememberedRange("custom:not-a-date..2026-02-01", TODAY)).toBeNull();
    expect(decodeRememberedRange("custom:2026-02-01", TODAY)).toBeNull();
    expect(decodeRememberedRange("custom:2026-03-01..2026-02-01", TODAY)).toBeNull();
    expect(decodeRememberedRange("totally-bogus", TODAY)).toBeNull();
  });
});

describe("encodeRememberedRange", () => {
  it("stores a preset key verbatim (stays rolling)", () => {
    expect(encodeRememberedRange("30", "2026-05-11", "2026-06-09")).toBe("30");
    expect(encodeRememberedRange("lifetime", LIFETIME_FLOOR, TODAY)).toBe(
      "lifetime",
    );
  });

  it("stores a custom range when there's no preset key", () => {
    expect(encodeRememberedRange(null, "2026-01-01", "2026-02-15")).toBe(
      "custom:2026-01-01..2026-02-15",
    );
  });

  it("returns null when there's nothing to remember", () => {
    expect(encodeRememberedRange(null, null, null)).toBeNull();
  });

  it("round-trips preset and custom through decode", () => {
    const enc = encodeRememberedRange(null, "2026-01-01", "2026-02-15");
    expect(decodeRememberedRange(enc, TODAY)).toEqual({
      from: "2026-01-01",
      to: "2026-02-15",
    });
    expect(decodeRememberedRange(encodeRememberedRange("7", null, null), TODAY)).toEqual(
      decodeRememberedRange("7", TODAY),
    );
  });
});
