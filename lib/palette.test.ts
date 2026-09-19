import { describe, expect, it } from "vitest";
import {
  ALL_PLATFORMS,
  PLATFORMS_WITH_CREATIVES,
  PLATFORM_COLOR,
  PLATFORM_LABEL,
} from "@/lib/palette";
import { unavailableFieldsFor } from "@/csv/platforms/types";
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

  it("PLATFORMS_WITH_CREATIVES is ALL_PLATFORMS minus the ones with no creatives", () => {
    // Google's exports are campaign/ad-group rows — no creative column — so it
    // has no creative-level data. Every creative-level surface derives from
    // this set, so it must stay a strict, derived subset.
    expect(PLATFORMS_WITH_CREATIVES).toEqual(
      ALL_PLATFORMS.filter((p) => p !== "google"),
    );
    expect(PLATFORMS_WITH_CREATIVES).not.toContain("google");
    for (const p of PLATFORMS_WITH_CREATIVES) {
      expect(ALL_PLATFORMS).toContain(p);
    }
  });

  it("the excluded platform is exactly the one with no funnel to report", () => {
    // The two rules coincide today and the funnel surfaces reuse this set —
    // if that ever stops being true, this test is the reminder to split them.
    const missingFunnel = ALL_PLATFORMS.filter((p) =>
      unavailableFieldsFor(p).includes("landing_page_views"),
    );
    expect(missingFunnel).toEqual(
      ALL_PLATFORMS.filter((p) => !PLATFORMS_WITH_CREATIVES.includes(p)),
    );
  });
});
