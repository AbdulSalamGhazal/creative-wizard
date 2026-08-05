import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
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
  accounts,
  performanceRecords,
  storeSourceMappings,
  users,
} from "@/db/schema";
import { writeStoreBatch } from "@/db/queries/store";
import {
  reconciliationOverview,
  reconciliationByPlatform,
  distinctStoreSourceValues,
} from "@/db/queries/reconciliation";
import {
  resetAndSeed,
  CREATIVE_1,
  CAMPAIGN_1,
  CAMPAIGN_2,
} from "./fixtures";

// Fixture literals (fixtures.ts doesn't export these).
const BATCH_A = "55555555-5555-5555-5555-555555555001";
const UPLOADER = "dddddddd-0000-0000-0000-0000000000e1";
const D = "2026-05-01"; // isolated test day (fixtures seed ads only in January)

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

const perfRow = (
  platform: "instagram" | "facebook",
  campaignId: string,
  conversions: number,
) => ({
  accountId: ACCOUNT_A,
  creativeId: CREATIVE_1,
  platform,
  date: D,
  campaignId,
  spend: "50",
  impressions: 1000,
  clicks: 50,
  conversions,
  conversionValue: "0",
  landingPageViews: 100,
  rawPayload: {},
  uploadBatchId: BATCH_A,
  excludedFromAggregates: false,
});

const order = (orderId: string, source: string) => ({
  orderId,
  orderDate: D,
  totalAmount: "100.00",
  attributes: { source },
});

beforeAll(async () => {
  await resetAndSeed();
  await db.insert(users).values({
    id: UPLOADER,
    email: "recon-uploader@store.test",
    name: "Uploader",
    role: "editor",
  });

  // Ads side on D: IG claims 4, FB claims 3 (total 7).
  await db.insert(performanceRecords).values([
    perfRow("instagram", CAMPAIGN_1, 4),
    perfRow("facebook", CAMPAIGN_2, 3),
  ]);

  // Store side on D: 10 orders — 5 ig_ad, 3 fb_ad, 2 newsletter.
  await writeStoreBatch({
    accountId: ACCOUNT_A,
    fileName: "recon.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [
      order("A1", "ig_ad"), order("A2", "ig_ad"), order("A3", "ig_ad"),
      order("A4", "ig_ad"), order("A5", "ig_ad"),
      order("A6", "fb_ad"), order("A7", "fb_ad"), order("A8", "fb_ad"),
      order("A9", "newsletter"), order("A10", "newsletter"),
    ],
    updates: [],
  });

  // Configure account A's source field + map ig_ad/fb_ad (newsletter left unmapped).
  await db.update(accounts).set({ storeSourceFieldKey: "source" }).where(eq(accounts.id, ACCOUNT_A));
  await db.insert(storeSourceMappings).values([
    { accountId: ACCOUNT_A, rawValue: "ig_ad", platform: "instagram" },
    { accountId: ACCOUNT_A, rawValue: "fb_ad", platform: "facebook" },
  ]);

  // Account B: one order on D with the SAME raw value, but no mapping of its own.
  await writeStoreBatch({
    accountId: ACCOUNT_B,
    fileName: "recon-b.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [order("B1", "ig_ad")],
    updates: [],
  });
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("reconciliation — overview Δ, by-platform buckets, scoping", () => {
  it("overview: store 10 vs claimed 7 → Δ +3 on the day", async () => {
    const rows = await reconciliationOverview(D, D);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.day).toBe(D);
    expect(r.storeOrders).toBe(10);
    expect(r.platformConv).toBe(7); // IG 4 + FB 3
    expect(r.storeOrders - r.platformConv).toBe(3);
    expect(r.storeRevenue).toBeCloseTo(1000, 2); // 10 × 100 (context only)
  });

  it("by-platform buckets reconcile: 5 IG + 3 FB + 2 unattributed = 10", async () => {
    const rows = await reconciliationByPlatform("source", D, D);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.storeByPlatform.instagram).toBe(5);
    expect(r.storeByPlatform.facebook).toBe(3);
    expect(r.claimedByPlatform.instagram).toBe(4);
    expect(r.claimedByPlatform.facebook).toBe(3);
    expect(r.unattributed).toBe(2); // newsletter is unmapped
    const bucketSum =
      Object.values(r.storeByPlatform).reduce((a, b) => a + b, 0) + r.unattributed;
    expect(bucketSum).toBe(r.storeOrders);
    expect(r.storeOrders).toBe(10);
  });

  it("a mapping change moves orders between buckets", async () => {
    await db.insert(storeSourceMappings).values({
      accountId: ACCOUNT_A,
      rawValue: "newsletter",
      platform: "tiktok",
    });
    const r = (await reconciliationByPlatform("source", D, D))[0]!;
    expect(r.storeByPlatform.tiktok).toBe(2);
    expect(r.unattributed).toBe(0);
    // cleanup so other tests see the original state
    await db
      .delete(storeSourceMappings)
      .where(and(eq(storeSourceMappings.accountId, ACCOUNT_A), eq(storeSourceMappings.rawValue, "newsletter")));
  });

  it("distinctStoreSourceValues returns raw values by frequency desc", async () => {
    const vals = await distinctStoreSourceValues("source");
    expect(vals.map((v) => v.value)).toEqual(["ig_ad", "fb_ad", "newsletter"]);
    expect(vals.map((v) => v.count)).toEqual([5, 3, 2]);
  });

  it("is account-scoped — A's mappings never attribute B's identical value", async () => {
    setAccount(ACCOUNT_B);
    const r = (await reconciliationByPlatform("source", D, D))[0]!;
    // B has no mapping for ig_ad → its lone order is Unattributed, not Instagram.
    expect(r.storeByPlatform.instagram ?? 0).toBe(0);
    expect(r.unattributed).toBe(1);
    expect(r.storeOrders).toBe(1);

    const ov = (await reconciliationOverview(D, D))[0]!;
    expect(ov.storeOrders).toBe(1);
    expect(ov.platformConv).toBe(0); // B has no ads data on D
  });
});
