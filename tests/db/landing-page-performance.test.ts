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
import {
  creatives,
  landingPages,
  performanceRecords,
  products,
  uploadBatches,
} from "@/db/schema";
import {
  landingPageDaily,
  landingPageRollup,
} from "@/db/queries/landing-page-performance";
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

const LP_A = "66666666-6666-6666-6666-6666666660a2";
const LP_B = "66666666-6666-6666-6666-6666666660b2";
/** A page registered before pages sold a product, that the backfill couldn't settle. */
const LP_ORPHAN = "66666666-6666-6666-6666-6666666660a3";
const BATCH = "55555555-5555-5555-5555-5555555559a2";
/** A second account-A product with spend but NO landing page: left off the page. */
const PRODUCT_A2 = "22222222-2222-2222-2222-2222222222a2";
const CREATIVE_3 = "33333333-3333-3333-3333-333333333003";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

/**
 * Trends → LPs. The fixtures hold account A's four main-page rows on
 * PRODUCT_A (spend 400 non-excluded: IG 100 + 100 on 01-01/01-02, FB 200 on
 * 01-01; plus the excluded 1000). On top, this file sends traffic to a
 * landing page registered under PRODUCT_A:
 *   LP_A ← CREATIVE_1 / IG / 01-01: spend 50 · impr 500 · clicks 25 · conv 5 · value 400
 *   LP_A ← CREATIVE_2 / FB / 01-02: spend 30 · impr 300 · clicks 30 · conv 3 · value 90
 *   LP_A ← a GOOGLE row (spend 999) that the creative-level scope must drop
 *   LP_B ← account B (spend 555) that must never leak into A
 * and adds PRODUCT_A2 with one main-page row (spend 60) and no landing page.
 */
beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
  await db.insert(products).values({
    id: PRODUCT_A2, accountId: ACCOUNT_A, name: "Product A2", slug: "product-a2", createdByUserId: USER,
  });
  await db.insert(creatives).values({
    id: CREATIVE_3, accountId: ACCOUNT_A, name: "A-Creative-3", productId: PRODUCT_A2, type: "image", createdByUserId: USER,
  });
  await db.insert(landingPages).values([
    { id: LP_A, accountId: ACCOUNT_A, name: "Ramadan offer", code: "ramadan", url: "https://a.test/ramadan", productId: PRODUCT_A, createdByUserId: USER },
    { id: LP_B, accountId: ACCOUNT_B, name: "B page", code: "bpage", url: "https://b.test", productId: PRODUCT_B, createdByUserId: USER },
  ]);
  await db.insert(uploadBatches).values({
    id: BATCH, accountId: ACCOUNT_A, platform: "instagram", fileName: "lp.csv", uploadedByUserId: USER, rowsImported: 3,
  });
  await db.insert(performanceRecords).values([
    { accountId: ACCOUNT_A, creativeId: CREATIVE_1, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-01", landingPageId: LP_A, spend: "50", impressions: 500, clicks: 25, conversions: 5, conversionValue: "400", landingPageViews: 100, rawPayload: {}, uploadBatchId: BATCH },
    { accountId: ACCOUNT_A, creativeId: CREATIVE_2, platform: "facebook", campaignId: CAMPAIGN_2, date: "2026-01-02", landingPageId: LP_A, spend: "30", impressions: 300, clicks: 30, conversions: 3, conversionValue: "90", landingPageViews: 60, rawPayload: {}, uploadBatchId: BATCH },
    { accountId: ACCOUNT_A, creativeId: CREATIVE_1, platform: "google", campaignId: CAMPAIGN_1, date: "2026-01-01", landingPageId: LP_A, spend: "999", impressions: 9000, clicks: 900, conversions: 90, rawPayload: {}, uploadBatchId: BATCH },
    { accountId: ACCOUNT_A, creativeId: CREATIVE_3, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-01", landingPageId: null, spend: "60", impressions: 600, clicks: 6, conversions: 1, conversionValue: "10", rawPayload: {}, uploadBatchId: BATCH },
    { accountId: ACCOUNT_B, creativeId: CREATIVE_B, platform: "instagram", campaignId: CAMPAIGN_B, date: "2026-01-01", landingPageId: LP_B, spend: "555", impressions: 5000, clicks: 50, conversions: 5, conversionValue: "500", rawPayload: {}, uploadBatchId: BATCH },
  ]);
});

type Rows = Awaited<ReturnType<typeof landingPageRollup>>;
const productPage = (rows: Rows, productId: string | null = PRODUCT_A) =>
  rows.filter((r) => r.landingPageId === null && r.productId === productId);
const ramadan = (rows: Rows) => rows.filter((r) => r.landingPageId === LP_A);

describe("landingPageRollup — one row per (product, landing page)", () => {
  it("keeps the product's own page as its own row and blends every ratio from component sums", async () => {
    const rows = await landingPageRollup({});
    expect(rows).toHaveLength(2);

    const [main] = productPage(rows);
    expect(main).toBeDefined();
    expect(main!.productId).toBe(PRODUCT_A);
    expect(main!.productName).toBe("Product A");
    expect(main!.name).toBeNull();
    expect(main!.code).toBeNull();
    expect(main!.platform).toBeNull();
    expect(main!.creatives).toBe(1);
    expect(main!.spend).toBeCloseTo(400, 4);
    expect(main!.impressions).toBe(4000);
    expect(main!.clicks).toBe(300);
    expect(main!.conversions).toBe(40);
    expect(main!.conversionValue).toBeCloseTo(2000, 4);
    expect(main!.landingPageViews).toBe(800);
    // SUM(clicks)/SUM(impressions) = 300/4000 — never the mean of per-row CTRs.
    expect(main!.ctr).toBeCloseTo(0.075, 6);
    expect(main!.cpa).toBeCloseTo(10, 6);
    expect(main!.roas).toBeCloseTo(5, 6);
    expect(main!.cpm).toBeCloseTo(100, 6);
    expect(main!.cvr).toBeCloseTo(40 / 800, 6);

    const [lp] = ramadan(rows);
    expect(lp).toBeDefined();
    expect(lp!.productId).toBe(PRODUCT_A);
    expect(lp!.productName).toBe("Product A");
    expect(lp!.name).toBe("Ramadan offer");
    expect(lp!.code).toBe("ramadan");
    expect(lp!.url).toBe("https://a.test/ramadan");
    expect(lp!.creatives).toBe(2);
    expect(lp!.spend).toBeCloseTo(80, 4);
    expect(lp!.impressions).toBe(800);
    expect(lp!.clicks).toBe(55);
    expect(lp!.conversions).toBe(8);
    expect(lp!.conversionValue).toBeCloseTo(490, 4);
    expect(lp!.ctr).toBeCloseTo(55 / 800, 6);
    expect(lp!.cpc).toBeCloseTo(80 / 55, 6);
    expect(lp!.cpa).toBeCloseTo(10, 6);
    expect(lp!.roas).toBeCloseTo(490 / 80, 6);

    // Biggest spender first.
    expect(rows[0]!.landingPageId).toBeNull();
  });

  it("leaves a product with no registered landing page off the page entirely", async () => {
    // PRODUCT_A2 spent 60 on its own page but has nothing to compare it with.
    const rows = await landingPageRollup({});
    expect(productPage(rows, PRODUCT_A2)).toEqual([]);
    expect(rows.every((r) => r.productId === PRODUCT_A)).toBe(true);
    // …until a page is registered under it: then its own page appears.
    await db.insert(landingPages).values({
      id: LP_ORPHAN, accountId: ACCOUNT_A, name: "A2 page", code: "a2", url: "https://a.test/a2", productId: PRODUCT_A2, createdByUserId: USER,
    });
    const after = await landingPageRollup({});
    expect(productPage(after, PRODUCT_A2)[0]!.spend).toBeCloseTo(60, 4);
    expect(after).toHaveLength(3); // the registered page itself has no records, so no zero row
  });

  it("counts a landing-page record under the PAGE's product, and a page with no product under null", async () => {
    // A pre-backfill page with no product, with a PRODUCT_A creative's record.
    await db.insert(landingPages).values({
      id: LP_ORPHAN, accountId: ACCOUNT_A, name: "Old page", code: "old", url: "https://a.test/old", productId: null, createdByUserId: USER,
    });
    await db.insert(performanceRecords).values({
      accountId: ACCOUNT_A, creativeId: CREATIVE_1, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-02", landingPageId: LP_ORPHAN, spend: "7", impressions: 70, clicks: 7, rawPayload: {}, uploadBatchId: BATCH,
    });
    const rows = await landingPageRollup({});
    const old = rows.find((r) => r.landingPageId === LP_ORPHAN)!;
    expect(old.productId).toBeNull();
    expect(old.productName).toBeNull();
    expect(old.spend).toBeCloseTo(7, 4);
    // Product A's own page is unchanged by it.
    expect(productPage(rows)[0]!.spend).toBeCloseTo(400, 4);
  });

  it("drops google rows (creative-level scope), even under a forged platform filter", async () => {
    const rows = await landingPageRollup({});
    expect(ramadan(rows)[0]!.spend).toBeCloseTo(80, 4); // not 1079
    expect(await landingPageRollup({ platforms: ["google"] })).toEqual([]);
  });

  it("honours the Excluded toggle: hidden by default, counted when opted in", async () => {
    const hidden = await landingPageRollup({});
    expect(productPage(hidden)[0]!.spend).toBeCloseTo(400, 4);
    const shown = await landingPageRollup({ includeExcluded: true });
    expect(productPage(shown)[0]!.spend).toBeCloseTo(1400, 4);
    // The landing page's rows are not excluded, so its number does not move.
    expect(ramadan(shown)[0]!.spend).toBeCloseTo(80, 4);
  });

  it("applies the range and the platform and product filters", async () => {
    const day2 = await landingPageRollup({ from: "2026-01-02", to: "2026-01-02" });
    expect(productPage(day2)[0]!.spend).toBeCloseTo(100, 4);
    expect(ramadan(day2)[0]!.spend).toBeCloseTo(30, 4);

    const fb = await landingPageRollup({ platforms: ["facebook"] });
    expect(productPage(fb)[0]!.spend).toBeCloseTo(200, 4);
    expect(ramadan(fb)[0]!.spend).toBeCloseTo(30, 4);
    expect(ramadan(fb)[0]!.creatives).toBe(1);

    // The product filter is the product a row COUNTS under: a group arrives whole.
    expect(await landingPageRollup({ productIds: [PRODUCT_A] })).toHaveLength(2);
    expect(await landingPageRollup({ productIds: [PRODUCT_A2] })).toEqual([]);
    expect(await landingPageRollup({ productIds: [PRODUCT_B] })).toEqual([]);
  });

  it("splits into one row per (product, landing page, platform) on request", async () => {
    const rows = await landingPageRollup({}, { byPlatform: true });
    const lpRows = ramadan(rows);
    expect(lpRows.map((r) => [r.platform, r.spend]).sort()).toEqual([
      ["facebook", 30],
      ["instagram", 50],
    ]);
    expect(lpRows.every((r) => r.productId === PRODUCT_A)).toBe(true);
    const mainRows = productPage(rows);
    expect(mainRows.map((r) => [r.platform, r.spend]).sort()).toEqual([
      ["facebook", 200],
      ["instagram", 200],
    ]);
    // Each split row carries its own weighted ratio.
    const ig = lpRows.find((r) => r.platform === "instagram")!;
    expect(ig.ctr).toBeCloseTo(25 / 500, 6);
  });

  it("is scoped to the active brand on both sides of the join", async () => {
    setAccount(ACCOUNT_B);
    const rows = await landingPageRollup({});
    expect(rows.map((r) => r.code).sort()).toEqual([null, "bpage"].sort());
    expect(productPage(rows, PRODUCT_B)[0]!.spend).toBeCloseTo(777, 4);
    expect(rows.find((r) => r.landingPageId === LP_B)!.spend).toBeCloseTo(555, 4);
    expect(ramadan(rows)).toEqual([]);
  });
});

describe("landingPageDaily — per-day component sums per (product, landing page)", () => {
  it("returns one point per (day, product, landing page), the product page included, google out", async () => {
    const rows = await landingPageDaily({});
    const pick = (date: string, lp: string | null) =>
      rows.find((r) => r.date === date && r.landingPageId === lp && r.productId === PRODUCT_A);
    expect(pick("2026-01-01", null)!.spend).toBeCloseTo(300, 4);
    expect(pick("2026-01-01", null)!.conversions).toBe(30);
    expect(pick("2026-01-02", null)!.spend).toBeCloseTo(100, 4);
    expect(pick("2026-01-01", LP_A)!.spend).toBeCloseTo(50, 4);
    expect(pick("2026-01-02", LP_A)!.spend).toBeCloseTo(30, 4);
    expect(pick("2026-01-02", LP_A)!.conversions).toBe(3);
    // The component sums the chart derives its ratios from — a day's ROAS is
    // that day's value / spend (400 / 50 = 8 for the page on 01-01).
    expect(pick("2026-01-01", LP_A)).toMatchObject({
      impressions: 500,
      clicks: 25,
      conversionValue: 400,
      landingPageViews: 100,
    });
    expect(pick("2026-01-01", null)).toMatchObject({
      impressions: 3000,
      clicks: 200,
      conversionValue: 1500,
      landingPageViews: 600,
    });
    // The excluded 01-03 row is hidden; nothing from google, account B, or the
    // product with no landing page.
    expect(pick("2026-01-03", null)).toBeUndefined();
    expect(rows.some((r) => r.productId === PRODUCT_A2)).toBe(false);
    expect(rows.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(480, 4);
    // Dates arrive as ISO day strings, in order.
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
    expect(rows[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("follows the same filters as the rollup", async () => {
    const fb = await landingPageDaily({ platforms: ["facebook"], includeExcluded: true });
    expect(fb.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(230, 4);
  });
});
