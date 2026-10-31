import { describe, it, expect } from "vitest";
import {
  decodePreferredRange,
  explicitRange,
  encodePreferredRange,
  LIFETIME_FLOOR,
  shiftIso,
} from "@/lib/date-presets";

// Fixed "today" so preset math is deterministic. "Last N days" end YESTERDAY.
const TODAY = "2026-06-10";

describe("encodePreferredRange", () => {
  it("stores a preset key verbatim (stays rolling)", () => {
    expect(encodePreferredRange("30", "2026-05-11", "2026-06-09")).toBe("30");
    expect(encodePreferredRange("lifetime", LIFETIME_FLOOR, TODAY)).toBe("lifetime");
  });
  it("stores explicit dates when there's no preset key", () => {
    expect(encodePreferredRange(null, "2026-01-01", "2026-02-15")).toBe(
      "custom:2026-01-01..2026-02-15",
    );
  });
  it("returns null when there's nothing to store", () => {
    expect(encodePreferredRange(null, null, null)).toBeNull();
  });
});

describe("decodePreferredRange", () => {
  it("returns null for absent / empty values", () => {
    expect(decodePreferredRange(undefined, TODAY)).toBeNull();
    expect(decodePreferredRange(null, TODAY)).toBeNull();
    expect(decodePreferredRange("", TODAY)).toBeNull();
  });
  it("resolves a preset key as a ROLLING range relative to today", () => {
    expect(decodePreferredRange("7", TODAY)).toEqual({ from: "2026-06-03", to: "2026-06-09" });
    expect(decodePreferredRange("30", TODAY)).toEqual({ from: "2026-05-11", to: "2026-06-09" });
  });
  it("resolves lifetime to floor → today", () => {
    expect(decodePreferredRange("lifetime", TODAY)).toEqual({ from: LIFETIME_FLOOR, to: TODAY });
  });
  it("parses an explicit custom range", () => {
    expect(decodePreferredRange("custom:2026-01-01..2026-02-15", TODAY)).toEqual({
      from: "2026-01-01",
      to: "2026-02-15",
    });
  });
  it("rejects malformed custom ranges and unknown keys", () => {
    expect(decodePreferredRange("custom:nope..2026-02-01", TODAY)).toBeNull();
    expect(decodePreferredRange("custom:2026-02-01", TODAY)).toBeNull();
    expect(decodePreferredRange("custom:2026-03-01..2026-02-01", TODAY)).toBeNull();
    expect(decodePreferredRange("bogus", TODAY)).toBeNull();
  });
  it("round-trips encode → decode", () => {
    const enc = encodePreferredRange(null, "2026-01-01", "2026-02-15");
    expect(decodePreferredRange(enc, TODAY)).toEqual({ from: "2026-01-01", to: "2026-02-15" });
  });
});

describe("shiftIso — the one day-arithmetic helper (C-25)", () => {
  it("adds and subtracts calendar days across month and year ends", () => {
    expect(shiftIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIso("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftIso("2026-10-24", 0)).toBe("2026-10-24");
  });
  it("is the same function everywhere the app shifts a day", async () => {
    const { isoMinusDays } = await import("@/lib/creative-status");
    const { isoPlusDays } = await import("@/lib/budget");
    expect(isoMinusDays("2026-01-01", 1)).toBe(shiftIso("2026-01-01", -1));
    expect(isoPlusDays("2026-01-31")).toBe(shiftIso("2026-01-31", 1));
  });
  it("an unparseable input shifts from today rather than throwing", () => {
    expect(shiftIso("nope", 0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("explicitRange — a URL range is used only when both ends are REAL dates", () => {
  // The shape alone let `?from=2026-02-30` reach Postgres (22008) and
  // `2026-13-01` throw a RangeError in date math: the page errored instead
  // of falling back to the saved range (2026-10-31).
  it("accepts real, ordered dates", () => {
    expect(explicitRange("2026-02-01", "2026-02-28")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(explicitRange("2028-02-29", "2028-03-01")).toEqual({ from: "2028-02-29", to: "2028-03-01" });
  });

  it("refuses impossible dates, half ranges and reversed ranges", () => {
    expect(explicitRange("2026-02-30", "2026-03-05")).toBeNull();
    expect(explicitRange("2026-13-01", "2026-12-31")).toBeNull();
    expect(explicitRange("2026-01-01", null)).toBeNull();
    expect(explicitRange("2026-03-01", "2026-02-01")).toBeNull();
    expect(explicitRange("abc", "2026-02-01")).toBeNull();
  });

  it("guards a stored custom range the same way", () => {
    expect(decodePreferredRange("custom:2026-02-30..2026-03-05", TODAY)).toBeNull();
  });
});
