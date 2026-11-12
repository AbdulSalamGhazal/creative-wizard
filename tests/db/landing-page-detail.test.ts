import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { landingPages, performanceRecords, uploadBatches } from "@/db/schema";
import { campaignMix, kpis, platformMix } from "@/db/queries/performance";
import { getLandingPageByCode, landingPageCreatives } from "@/db/queries/landing-pages";
import { resolveAnchorPath } from "@/db/queries/comments";
import {
  CAMPAIGN_1,
  CAMPAIGN_2,
  CAMPAIGN_B,
  CREATIVE_1,
  CREATIVE_2,
  CREATIVE_B,
  PRODUCT_A,
  PRODUCT_B,
  USER,
  resetAndSeed,
} from "./fixtures";

const LP_A = "66666666-6666-6666-6666-6666666661a2";
const LP_B = "66666666-6666-6666-6666-6666666661b2";
const BATCH = "55555555-5555-5555-5555-5555555559b7";
const RANGE = { from: "2026-01-01", to: "2026-01-31" };

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

/**
 * A landing page's detail page (2026-11-12). On top of the fixtures' main-page
 * rows (no landing page — they must never count here), account A sends:
 *   LP_A ← CREATIVE_1 / IG / 01-01: spend 50 · impr 500 · clicks 25 · conv 5 · value 400
 *   LP_A ← CREATIVE_2 / FB / 01-02: spend 30 · impr 300 · clicks 30 · conv 3 · value 90
 *   LP_A ← CREATIVE_1 / IG / 01-03, EXCLUDED: spend 700 · conv 70
 * and account B sends 555 to its own page with the SAME code.
 */
beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
  await db.insert(landingPages).values([
    { id: LP_A, accountId: ACCOUNT_A, name: "Ramadan offer", code: "ramadan", url: "https://a.test/ramadan", productId: PRODUCT_A, createdByUserId: USER },
    { id: LP_B, accountId: ACCOUNT_B, name: "B's ramadan", code: "ramadan", url: "https://b.test", productId: PRODUCT_B, createdByUserId: USER },
  ]);
  await db.insert(uploadBatches).values({
    id: BATCH, accountId: ACCOUNT_A, platform: "instagram", fileName: "lp.csv", uploadedByUserId: USER, rowsImported: 4,
  });
  await db.insert(performanceRecords).values([
    { accountId: ACCOUNT_A, creativeId: CREATIVE_1, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-01", landingPageId: LP_A, spend: "50", impressions: 500, clicks: 25, conversions: 5, conversionValue: "400", rawPayload: {}, uploadBatchId: BATCH },
    { accountId: ACCOUNT_A, creativeId: CREATIVE_2, platform: "facebook", campaignId: CAMPAIGN_2, date: "2026-01-02", landingPageId: LP_A, spend: "30", impressions: 300, clicks: 30, conversions: 3, conversionValue: "90", rawPayload: {}, uploadBatchId: BATCH },
    { accountId: ACCOUNT_A, creativeId: CREATIVE_1, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-03", landingPageId: LP_A, spend: "700", impressions: 7000, clicks: 70, conversions: 70, conversionValue: "7000", excludedFromAggregates: true, excludedSource: "manual", rawPayload: {}, uploadBatchId: BATCH },
    { accountId: ACCOUNT_B, creativeId: CREATIVE_B, platform: "instagram", campaignId: CAMPAIGN_B, date: "2026-01-01", landingPageId: LP_B, spend: "555", impressions: 5000, clicks: 50, conversions: 5, conversionValue: "500", rawPayload: {}, uploadBatchId: BATCH },
  ]);
});

describe("getLandingPageByCode", () => {
  it("finds the active brand's page by its code, with its usage", async () => {
    const page = await getLandingPageByCode("ramadan");
    expect(page?.id).toBe(LP_A);
    expect(page?.productName).toBe("Product A");
    expect(page?.records).toBe(3);
    expect(page?.creatives).toBe(2);
  });

  it("is exact, and never another brand's page with the same code", async () => {
    expect(await getLandingPageByCode("Ramadan")).toBeNull();
    expect(await getLandingPageByCode("nope")).toBeNull();
    setAccount(ACCOUNT_B);
    expect((await getLandingPageByCode("ramadan"))?.id).toBe(LP_B);
  });
});

describe("KpiFilters.landingPageIds — the detail page's scope", () => {
  it("counts only this page's records, weighted from component sums, excluded hidden", async () => {
    const k = await kpis({ landingPageIds: [LP_A], ...RANGE });
    expect(k.spend).toBe(80);
    expect(k.conversions).toBe(8);
    expect(k.conversionValue).toBe(490);
    expect(k.roas).toBeCloseTo(490 / 80, 6);
    expect(k.ctr).toBeCloseTo(55 / 800, 6);
  });

  it("counts the excluded row when the toggle opts in", async () => {
    const k = await kpis({ landingPageIds: [LP_A], ...RANGE, includeExcluded: true });
    expect(k.spend).toBe(780);
  });

  it("splits by platform and campaign, and never reaches another brand", async () => {
    const byPlatform = await platformMix({ landingPageIds: [LP_A], ...RANGE });
    expect(byPlatform.map((r) => [r.platform, r.spend])).toEqual([
      ["instagram", 50],
      ["facebook", 30],
    ]);
    const byCampaign = await campaignMix({ landingPageIds: [LP_A], ...RANGE });
    expect(byCampaign).toHaveLength(2);
    // B's page id, asked from A: the account scope wins.
    expect((await kpis({ landingPageIds: [LP_B], ...RANGE })).spend).toBeNull();
  });
});

describe("landingPageCreatives", () => {
  it("one row per creative that sent traffic, by spend", async () => {
    const rows = await landingPageCreatives(LP_A, RANGE, false);
    expect(rows.map((r) => [r.creativeId, r.spend, r.conversions])).toEqual([
      [CREATIVE_1, 50, 5],
      [CREATIVE_2, 30, 3],
    ]);
    expect(rows[0]!.roas).toBeCloseTo(8, 6);
    const withExcluded = await landingPageCreatives(LP_A, RANGE, true);
    expect(withExcluded[0]!.spend).toBe(750);
  });

  it("is empty for another brand's page", async () => {
    expect(await landingPageCreatives(LP_B, RANGE, false)).toEqual([]);
  });
});

describe("a landing page as a comment anchor", () => {
  it("resolves to its code's path, labelled by its name, in its own brand only", async () => {
    expect(await resolveAnchorPath("landing_page", LP_A, ACCOUNT_A)).toEqual({
      path: "/landing-pages/ramadan",
      label: "Ramadan offer",
    });
    expect(await resolveAnchorPath("landing_page", LP_A, ACCOUNT_B)).toBeNull();
  });
});
