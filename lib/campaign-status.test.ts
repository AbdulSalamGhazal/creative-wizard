import { describe, expect, it } from "vitest";
import { deriveCampaignStatus } from "@/lib/campaign-status";

describe("deriveCampaignStatus", () => {
  it("is active when the last spend is exactly on the window threshold", () => {
    // windowDays 1 → threshold = the platform's latest day itself.
    expect(
      deriveCampaignStatus({
        lastSpendDay: "2026-06-20",
        platformLatestDay: "2026-06-20",
        windowDays: 1,
      }),
    ).toBe("active");
  });

  it("is inactive one day before the threshold (window 1)", () => {
    expect(
      deriveCampaignStatus({
        lastSpendDay: "2026-06-19",
        platformLatestDay: "2026-06-20",
        windowDays: 1,
      }),
    ).toBe("inactive");
  });

  it("widens with the window: 3-day window keeps a 2-days-stale campaign active", () => {
    // threshold = latest − (3 − 1) = 2026-06-18; last 06-18 ⇒ active, 06-17 ⇒ inactive.
    expect(
      deriveCampaignStatus({
        lastSpendDay: "2026-06-18",
        platformLatestDay: "2026-06-20",
        windowDays: 3,
      }),
    ).toBe("active");
    expect(
      deriveCampaignStatus({
        lastSpendDay: "2026-06-17",
        platformLatestDay: "2026-06-20",
        windowDays: 3,
      }),
    ).toBe("inactive");
  });

  it("is anchored to its platform's latest day, not today — a stale channel can't force inactive", () => {
    // The platform itself hasn't uploaded since 06-10; a campaign that last spent
    // 06-10 is still 'active' relative to that anchor.
    expect(
      deriveCampaignStatus({
        lastSpendDay: "2026-06-10",
        platformLatestDay: "2026-06-10",
        windowDays: 1,
      }),
    ).toBe("active");
  });

  it("is inactive when the campaign never spent (no last day)", () => {
    expect(
      deriveCampaignStatus({
        lastSpendDay: null,
        platformLatestDay: "2026-06-20",
        windowDays: 1,
      }),
    ).toBe("inactive");
  });

  it("is inactive when the platform has no spend anchor", () => {
    expect(
      deriveCampaignStatus({
        lastSpendDay: "2026-06-20",
        platformLatestDay: null,
        windowDays: 1,
      }),
    ).toBe("inactive");
  });
});
