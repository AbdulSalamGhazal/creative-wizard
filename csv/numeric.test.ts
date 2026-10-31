import { describe, expect, it } from "vitest";
import { parseNumber } from "@/csv/numeric";

describe("parseNumber — tolerant of formatting, never of a guess", () => {
  it("reads thousands separators, currency prefixes and unit suffixes", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("$1,234")).toBe(1234);
    expect(parseNumber("1234 USD")).toBe(1234);
    expect(parseNumber("1,234,567")).toBe(1234567);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("-12.45")).toBe(-12.45);
  });

  it("refuses a comma that isn't a thousands separator — `12,50` was read as 1250", () => {
    // validation-spec §5.1: the decimal point is the only decimal separator.
    // A comma-decimal cell is an E040, never a number 100× too large.
    expect(parseNumber("12,50")).toBeNull();
    expect(parseNumber("1,5")).toBeNull();
    expect(parseNumber("1.234,56")).toBeNull();
    expect(parseNumber("1,23,456")).toBeNull();
  });

  it("refuses a magnitude suffix — `5K` was read as 5", () => {
    expect(parseNumber("5K")).toBeNull();
    expect(parseNumber("1.2M")).toBeNull();
    expect(parseNumber("3b")).toBeNull();
  });

  it("reads the empty markers as nothing", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("—")).toBeNull();
    expect(parseNumber("N/A")).toBeNull();
  });
});
