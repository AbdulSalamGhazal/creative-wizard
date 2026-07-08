import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

// getActiveAccountId reads request cookies (unavailable in vitest) — stub the
// whole tenant module and drive the active account per test.
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { campaignMix, kpis, platformMix } from "@/db/queries/performance";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("kpis() — weighted aggregation (component sums)", () => {
  it("sums additive metrics over non-excluded rows", async () => {
    const k = await kpis({});
    expect(k.spend).toBeCloseTo(400, 4);
    expect(k.impressions).toBe(4000);
    expect(k.clicks).toBe(300);
    expect(k.conversions).toBe(40);
    expect(k.conversionValue).toBeCloseTo(2000, 4);
    expect(k.landingPageViews).toBe(800);
  });

  it("derives ratio metrics as SUM/NULLIF, not a mean of ratios", async () => {
    const k = await kpis({});
    expect(k.ctr).toBeCloseTo(0.075, 6); // 300 / 4000
    expect(k.cpm).toBeCloseTo(100, 4); // 400 / 4000 * 1000
    expect(k.cpa).toBeCloseTo(10, 4); // 400 / 40
    expect(k.roas).toBeCloseTo(5, 4); // 2000 / 400
    expect(k.cvr).toBeCloseTo(0.05, 6); // 40 / 800
  });

  it("excludes excluded_from_aggregates rows by default", async () => {
    // The excluded row alone is spend 1000 — its absence proves the filter.
    const k = await kpis({});
    expect(k.spend).toBeCloseTo(400, 4);
  });

  it("includeExcluded folds the excluded row back in", async () => {
    const k = await kpis({ includeExcluded: true });
    expect(k.spend).toBeCloseTo(1400, 4); // 400 + 1000
    expect(k.impressions).toBe(9000); // 4000 + 5000
    expect(k.conversions).toBe(140); // 40 + 100
    expect(k.conversionValue).toBeCloseTo(11999, 4);
  });

  it("scopes to the platform filter", async () => {
    const ig = await kpis({ platforms: ["instagram"] });
    expect(ig.spend).toBeCloseTo(200, 4); // camp1 only
    const fb = await kpis({ platforms: ["facebook"] });
    expect(fb.spend).toBeCloseTo(200, 4); // camp2 only
  });
});

describe("platformMix()", () => {
  it("splits weighted totals per platform", async () => {
    const rows = await platformMix({});
    const ig = rows.find((r) => r.platform === "instagram");
    const fb = rows.find((r) => r.platform === "facebook");
    expect(ig?.spend).toBeCloseTo(200, 4);
    expect(ig?.clicks).toBe(200);
    expect(fb?.spend).toBeCloseTo(200, 4);
    expect(fb?.clicks).toBe(100);
    // No excluded-row platform leaks a spend-1000 bucket.
    expect(rows.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(400, 4);
  });
});

describe("campaignMix()", () => {
  it("splits weighted totals per campaign", async () => {
    const rows = await campaignMix({});
    const byName = new Map(rows.map((r) => [r.campaign, r]));
    const camp1 = byName.get("Camp One ➤ Broad (IG)");
    const camp2 = byName.get("Camp Two ➤ Broad (FB)");
    expect(camp1?.spend).toBeCloseTo(200, 4);
    expect(camp2?.spend).toBeCloseTo(200, 4);
    expect(camp1?.clicks).toBe(200);
    expect(camp2?.clicks).toBe(100);
    expect(camp1?.platform).toBe("instagram");
    expect(camp2?.platform).toBe("facebook");
  });
});

describe("tenancy isolation", () => {
  it("Account B's rows never leak into Account A", async () => {
    const a = await kpis({});
    expect(a.spend).toBeCloseTo(400, 4); // no 777
  });

  it("switching the active account returns only that account's data", async () => {
    setAccount(ACCOUNT_B);
    const b = await kpis({});
    expect(b.spend).toBeCloseTo(777, 4);
    expect(b.impressions).toBe(7000);
    // Account B has one platform only.
    const mix = await platformMix({});
    expect(mix).toHaveLength(1);
    expect(mix[0]?.platform).toBe("instagram");
  });
});
