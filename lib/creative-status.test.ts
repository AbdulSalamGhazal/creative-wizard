import { describe, expect, it } from "vitest";
import {
  NEW_STATUS,
  STATUS_ORDER,
  deriveCreativeStatus,
  hoursToWindowDays,
  isoMinusDays,
} from "@/lib/creative-status";

describe("hoursToWindowDays", () => {
  it("rounds up to whole days with a floor of 1", () => {
    expect(hoursToWindowDays(24)).toBe(1); // default window = latest day only
    expect(hoursToWindowDays(25)).toBe(2);
    expect(hoursToWindowDays(48)).toBe(2);
    expect(hoursToWindowDays(72)).toBe(3);
    expect(hoursToWindowDays(1)).toBe(1);
    expect(hoursToWindowDays(0)).toBe(1); // 0/undefined falls back to 24h
  });
});

describe("isoMinusDays", () => {
  it("subtracts whole days in UTC, crossing month boundaries", () => {
    expect(isoMinusDays("2026-06-20", 1)).toBe("2026-06-19");
    expect(isoMinusDays("2026-07-01", 1)).toBe("2026-06-30");
    expect(isoMinusDays("2026-03-01", 1)).toBe("2026-02-28"); // non-leap
    expect(isoMinusDays("2026-06-20", 0)).toBe("2026-06-20");
  });
});

describe("deriveCreativeStatus — per-platform", () => {
  const ctx = {
    latestDayByPlatform: {
      instagram: "2026-06-20",
      tiktok: "2026-06-10", // stale channel: last upload with spend is older
    },
    windowDays: 1,
  };

  it("is active when the platform's last spend is on ITS OWN latest day", () => {
    const r = deriveCreativeStatus(
      { lastSpendByPlatform: { instagram: "2026-06-20" }, terminatedPlatforms: [] },
      ctx,
    );
    expect(r.perPlatform.instagram).toBe("active");
    expect(r.general).toBe("active");
  });

  it("anchors each platform to its own latest spend day — a stale channel can't force pause", () => {
    // TikTok hasn't had a spend upload since 06-10; a creative that spent on
    // 06-10 is still 'active' relative to that anchor.
    const r = deriveCreativeStatus(
      { lastSpendByPlatform: { tiktok: "2026-06-10" }, terminatedPlatforms: [] },
      ctx,
    );
    expect(r.perPlatform.tiktok).toBe("active");
  });

  it("is pause when the last spend predates the window", () => {
    const r = deriveCreativeStatus(
      { lastSpendByPlatform: { instagram: "2026-06-19" }, terminatedPlatforms: [] },
      ctx,
    );
    expect(r.perPlatform.instagram).toBe("pause");
    expect(r.general).toBe("pause");
  });

  it("widens with the window", () => {
    const wide = { ...ctx, windowDays: 3 }; // threshold = 06-18
    expect(
      deriveCreativeStatus(
        { lastSpendByPlatform: { instagram: "2026-06-18" }, terminatedPlatforms: [] },
        wide,
      ).perPlatform.instagram,
    ).toBe("active");
    expect(
      deriveCreativeStatus(
        { lastSpendByPlatform: { instagram: "2026-06-17" }, terminatedPlatforms: [] },
        wide,
      ).perPlatform.instagram,
    ).toBe("pause");
  });

  it("manual termination wins over recent spend on that platform", () => {
    const r = deriveCreativeStatus(
      {
        lastSpendByPlatform: { instagram: "2026-06-20" },
        terminatedPlatforms: ["instagram"],
      },
      ctx,
    );
    expect(r.perPlatform.instagram).toBe("terminated");
  });
});

describe("deriveCreativeStatus — general roll-up (active ▸ pause ▸ new ▸ terminated)", () => {
  const ctx = {
    latestDayByPlatform: { instagram: "2026-06-20", tiktok: "2026-06-20" },
    windowDays: 1,
  };

  it("active on ANY platform → general active (even with pauses elsewhere)", () => {
    const r = deriveCreativeStatus(
      {
        lastSpendByPlatform: { instagram: "2026-06-20", tiktok: "2026-06-01" },
        terminatedPlatforms: [],
      },
      ctx,
    );
    expect(r.general).toBe("active");
  });

  it("pause everywhere it ran → general pause", () => {
    const r = deriveCreativeStatus(
      {
        lastSpendByPlatform: { instagram: "2026-06-01", tiktok: "2026-06-02" },
        terminatedPlatforms: [],
      },
      ctx,
    );
    expect(r.general).toBe("pause");
  });

  it("never spent anywhere → general new (NEW_STATUS fallback shape)", () => {
    const r = deriveCreativeStatus(
      { lastSpendByPlatform: {}, terminatedPlatforms: [] },
      ctx,
    );
    expect(r.general).toBe("new");
    expect(r.perPlatform).toEqual({});
    expect(NEW_STATUS.general).toBe("new");
  });

  it("terminated on some platforms but untouched on others → general new, not terminated", () => {
    const r = deriveCreativeStatus(
      { lastSpendByPlatform: {}, terminatedPlatforms: ["instagram", "facebook"] },
      ctx,
    );
    expect(r.general).toBe("new"); // unused potential remains on tiktok/snapchat
  });

  it("terminated on ALL FOUR platforms → general terminated", () => {
    const r = deriveCreativeStatus(
      {
        lastSpendByPlatform: {},
        terminatedPlatforms: ["instagram", "facebook", "tiktok", "snapchat"],
      },
      ctx,
    );
    expect(r.general).toBe("terminated");
  });

  it("STATUS_ORDER ranks most-relevant first: active ▸ pause ▸ new ▸ terminated", () => {
    expect(STATUS_ORDER.active).toBeLessThan(STATUS_ORDER.pause);
    expect(STATUS_ORDER.pause).toBeLessThan(STATUS_ORDER.new);
    expect(STATUS_ORDER.new).toBeLessThan(STATUS_ORDER.terminated);
  });
});
