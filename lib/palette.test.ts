import { describe, expect, it } from "vitest";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { platformEnum } from "@/db/schema";

describe("platform list — single source of truth", () => {
  it("ALL_PLATFORMS ≡ platformEnum (schema derives from palette)", () => {
    expect([...platformEnum]).toEqual([...ALL_PLATFORMS]);
  });

  it("every platform has a color and a label", () => {
    for (const p of ALL_PLATFORMS) {
      expect(PLATFORM_COLOR[p]).toBeTruthy();
      expect(PLATFORM_LABEL[p]).toBeTruthy();
    }
  });
});
