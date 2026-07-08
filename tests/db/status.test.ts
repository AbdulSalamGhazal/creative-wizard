import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import { campaignStatusMap } from "@/db/queries/campaign-status";
import {
  resetAndSeed,
  CREATIVE_1,
  CREATIVE_2,
  CAMPAIGN_1,
  CAMPAIGN_2,
} from "./fixtures";

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A));

// Freshness anchor = each platform's OWN latest non-excluded spend day.
// Instagram latest = 2026-01-02, Facebook latest = 2026-01-01. Window = 24h
// (latest day only). The excluded 2026-01-03 row is ignored by the anchor.
describe("creativeStatusMap() — per-platform freshness", () => {
  it("a creative spending on each platform's latest day is Active", async () => {
    const map = await creativeStatusMap();
    expect(map.get(CREATIVE_1)?.general).toBe("active");
    // Per-platform: active on both instagram and facebook.
    expect(map.get(CREATIVE_1)?.perPlatform.instagram).toBe("active");
    expect(map.get(CREATIVE_1)?.perPlatform.facebook).toBe("active");
  });

  it("a creative with only an excluded row has no live spend → New", async () => {
    const map = await creativeStatusMap();
    // Creatives with no non-excluded presence are omitted from the map;
    // `statusFor` defaults them to New.
    expect(map.has(CREATIVE_2)).toBe(false);
    expect(statusFor(map, CREATIVE_2).general).toBe("new");
  });
});

describe("campaignStatusMap() — per-platform freshness", () => {
  it("campaigns live on their platform's latest day are Active", async () => {
    const map = await campaignStatusMap();
    expect(map.get(CAMPAIGN_1)).toBe("active"); // instagram, last spend 2026-01-02
    expect(map.get(CAMPAIGN_2)).toBe("active"); // facebook, last spend 2026-01-01
  });
});
