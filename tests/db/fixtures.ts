import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  campaigns,
  creatives,
  performanceRecords,
  products,
  uploadBatches,
  users,
} from "@/db/schema";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * Programmatic fixtures for the DB harness. Values are chosen so the expected
 * weighted aggregates are trivially hand-verifiable (see performance.test.ts).
 *
 * Account A (the account-under-test), non-excluded rows:
 *   spend 400 · impressions 4000 · clicks 300 · conversions 40 ·
 *   revenue 2000 · landingPageViews 800
 *   → CTR .075 · CPM 100 · CPA 10 · ROAS 5 · CvR .05
 *   platformMix: instagram(spend 200) + facebook(spend 200)
 *   campaignMix: camp1/instagram(spend 200) + camp2/facebook(spend 200)
 *   + one EXCLUDED row (spend 1000) that must not count unless includeExcluded.
 * Account B: a single spend-777 row that must NEVER leak into Account A results.
 */

// Fixed ids so tests can reference specific rows.
const USER = "11111111-1111-1111-1111-111111111111";
export const PRODUCT_A = "22222222-2222-2222-2222-2222222222a1";
export const PRODUCT_B = "22222222-2222-2222-2222-2222222222b1";
export const CREATIVE_1 = "33333333-3333-3333-3333-333333333001"; // A · video
export const CREATIVE_2 = "33333333-3333-3333-3333-333333333002"; // A · image (excluded rows)
export const CREATIVE_B = "33333333-3333-3333-3333-3333333330b1"; // B
export const CAMPAIGN_1 = "44444444-4444-4444-4444-444444444001"; // A · instagram
export const CAMPAIGN_2 = "44444444-4444-4444-4444-444444444002"; // A · facebook
export const CAMPAIGN_B = "44444444-4444-4444-4444-4444444440b1"; // B · instagram
const BATCH_A = "55555555-5555-5555-5555-555555555001";
const BATCH_B = "55555555-5555-5555-5555-5555555550b1";

type PerfRow = {
  creativeId: string;
  platform: "instagram" | "facebook" | "tiktok" | "snapchat";
  campaignId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
  excluded?: boolean;
  accountId: string;
  batchId: string;
};

function perf(r: PerfRow) {
  return {
    accountId: r.accountId,
    creativeId: r.creativeId,
    platform: r.platform,
    date: r.date,
    campaignId: r.campaignId,
    spend: String(r.spend),
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: String(r.conversionValue),
    landingPageViews: r.landingPageViews,
    rawPayload: {},
    uploadBatchId: r.batchId,
    excludedFromAggregates: r.excluded ?? false,
  };
}

/** Wipe every fixture table and re-seed. Call in `beforeAll` per test file. */
export async function resetAndSeed() {
  await db.execute(sql`
    TRUNCATE TABLE
      performance_records, upload_batches, campaigns, creatives,
      products, accounts, users
    RESTART IDENTITY CASCADE
  `);

  await db.insert(users).values({
    id: USER,
    email: "harness@test.local",
    name: "Harness",
    role: "admin",
  });

  await db.insert(accounts).values([
    { id: ACCOUNT_A, name: "Account A", slug: "account-a", statusWindowHours: 24 },
    { id: ACCOUNT_B, name: "Account B", slug: "account-b", statusWindowHours: 24 },
  ]);

  await db.insert(products).values([
    { id: PRODUCT_A, accountId: ACCOUNT_A, name: "Product A", slug: "product-a", createdByUserId: USER },
    { id: PRODUCT_B, accountId: ACCOUNT_B, name: "Product B", slug: "product-b", createdByUserId: USER },
  ]);

  await db.insert(creatives).values([
    { id: CREATIVE_1, accountId: ACCOUNT_A, name: "A-Creative-1", productId: PRODUCT_A, type: "video", createdByUserId: USER },
    { id: CREATIVE_2, accountId: ACCOUNT_A, name: "A-Creative-2", productId: PRODUCT_A, type: "image", createdByUserId: USER },
    { id: CREATIVE_B, accountId: ACCOUNT_B, name: "B-Creative-1", productId: PRODUCT_B, type: "video", createdByUserId: USER },
  ]);

  await db.insert(campaigns).values([
    { id: CAMPAIGN_1, accountId: ACCOUNT_A, name: "Camp One ➤ Broad (IG)", platform: "instagram", objective: "Sales", createdByUserId: USER },
    { id: CAMPAIGN_2, accountId: ACCOUNT_A, name: "Camp Two ➤ Broad (FB)", platform: "facebook", objective: "Sales", createdByUserId: USER },
    { id: CAMPAIGN_B, accountId: ACCOUNT_B, name: "Camp B ➤ Broad (IG)", platform: "instagram", objective: "Sales", createdByUserId: USER },
  ]);

  await db.insert(uploadBatches).values([
    { id: BATCH_A, accountId: ACCOUNT_A, platform: "instagram", fileName: "a.csv", uploadedByUserId: USER, rowsImported: 4 },
    { id: BATCH_B, accountId: ACCOUNT_B, platform: "instagram", fileName: "b.csv", uploadedByUserId: USER, rowsImported: 1 },
  ]);

  await db.insert(performanceRecords).values([
    // Account A — instagram / camp1 (spend 100 + 100)
    perf({ accountId: ACCOUNT_A, batchId: BATCH_A, creativeId: CREATIVE_1, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-01", spend: 100, impressions: 1000, clicks: 100, conversions: 10, conversionValue: 500, landingPageViews: 200 }),
    perf({ accountId: ACCOUNT_A, batchId: BATCH_A, creativeId: CREATIVE_1, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-02", spend: 100, impressions: 1000, clicks: 100, conversions: 10, conversionValue: 500, landingPageViews: 200 }),
    // Account A — facebook / camp2 (spend 200)
    perf({ accountId: ACCOUNT_A, batchId: BATCH_A, creativeId: CREATIVE_1, platform: "facebook", campaignId: CAMPAIGN_2, date: "2026-01-01", spend: 200, impressions: 2000, clicks: 100, conversions: 20, conversionValue: 1000, landingPageViews: 400 }),
    // Account A — EXCLUDED (must not count unless includeExcluded)
    perf({ accountId: ACCOUNT_A, batchId: BATCH_A, creativeId: CREATIVE_2, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-03", spend: 1000, impressions: 5000, clicks: 500, conversions: 100, conversionValue: 9999, landingPageViews: 1000, excluded: true }),
    // Account B — isolation sentinel (spend 777)
    perf({ accountId: ACCOUNT_B, batchId: BATCH_B, creativeId: CREATIVE_B, platform: "instagram", campaignId: CAMPAIGN_B, date: "2026-01-01", spend: 777, impressions: 7000, clicks: 70, conversions: 7, conversionValue: 700, landingPageViews: 70 }),
  ]);
}
