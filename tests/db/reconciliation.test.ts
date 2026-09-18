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
  storeChannelMappings,
  storeSourceMappings,
  users,
} from "@/db/schema";
import { writeStoreBatch, listStoreOrders } from "@/db/queries/store";
import {
  reconciliationOverview,
  reconciliationByPlatform,
  reconciliationByChannel,
  distinctStoreChannelValues,
  listStoreChannelMappings,
  distinctStoreSourceValues,
} from "@/db/queries/reconciliation";
import { channelDeltas } from "@/store/channels";
import { reconDelta } from "@/lib/reconciliation";
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

const order = (orderId: string, source: string, channel?: string) => {
  const attributes: Record<string, string | number> = { source };
  // An order with no channel column at all — the Unmapped bucket's other case.
  if (channel !== undefined) attributes.channel = channel;
  return { orderId, orderDate: D, totalAmount: "100.00", attributes };
};

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
      // Channels: 6 web, 3 app, 1 with a channel nobody has mapped.
      order("A1", "ig_ad", "web"), order("A2", "ig_ad", "web"),
      order("A3", "ig_ad", "web"), order("A4", "ig_ad", "web"),
      order("A5", "ig_ad", "ios"), order("A6", "fb_ad", "ios"),
      order("A7", "fb_ad", "ios"), order("A8", "fb_ad", "web"),
      order("A9", "newsletter", "web"), order("A10", "newsletter", "kiosk"),
    ],
    updates: [],
  });

  // Configure account A's source field + map ig_ad/fb_ad (newsletter left unmapped).
  await db.update(accounts).set({ storeSourceFieldKey: "source" }).where(eq(accounts.id, ACCOUNT_A));
  await db.insert(storeSourceMappings).values([
    { accountId: ACCOUNT_A, rawValue: "ig_ad", platform: "instagram" },
    { accountId: ACCOUNT_A, rawValue: "fb_ad", platform: "facebook" },
  ]);

  // Channel axis: web → Website, ios → Application. "kiosk" is left unmapped.
  await db.insert(storeChannelMappings).values([
    { accountId: ACCOUNT_A, rawValue: "web", destination: "website" },
    { accountId: ACCOUNT_A, rawValue: "ios", destination: "application" },
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
  it("overview: store 10 vs claimed 7 → Δ −3 on the day (claimed − store)", async () => {
    const rows = await reconciliationOverview(D, D);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.day).toBe(D);
    expect(r.storeOrders).toBe(10);
    expect(r.platformConv).toBe(7); // IG 4 + FB 3
    // Through the helper, so the DB suite pins the page's DIRECTION too:
    // claimed 7 − store 10 = −3 (platforms claim fewer than actually happened).
    expect(reconDelta(r.storeOrders, r.platformConv)).toBe(-3);
    expect(r.storeRevenue).toBeCloseTo(1000, 2); // 10 × 100 (context only)
  });

  it("by-platform buckets reconcile: 5 IG + 3 FB + 2 unattributed = 10", async () => {
    const rows = (await reconciliationByPlatform("source", D, D)).rows;
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

  /**
   * The unmapped-values banner now reads the set the by-platform scan already
   * produced, instead of a separate unbounded DISTINCT over every order the
   * brand ever uploaded. These pin the count logic the banner renders.
   */
  it("reports the DISTINCT unmapped raw values from the same scan", async () => {
    const res = await reconciliationByPlatform("source", D, D);
    // The fixture maps instagram + facebook; "newsletter" has no mapping row.
    expect(res.unmappedValues).toEqual(["newsletter"]);
  });

  it("a value mapped to 'not an ad platform' is NOT unmapped", async () => {
    // platform NULL = "this source isn't an ad platform" — a deliberate
    // mapping. It still lands in Unattributed, but there is nothing to fix,
    // so it must not raise the banner.
    await db.insert(storeSourceMappings).values({
      accountId: ACCOUNT_A,
      rawValue: "newsletter",
      platform: null,
    });
    const res = await reconciliationByPlatform("source", D, D);
    expect(res.unmappedValues).toEqual([]);
    expect(res.rows[0]!.unattributed).toBe(2); // still unattributed…

    // This file seeds once (beforeAll), so undo the mapping for the tests below.
    await db
      .delete(storeSourceMappings)
      .where(
        and(
          eq(storeSourceMappings.accountId, ACCOUNT_A),
          eq(storeSourceMappings.rawValue, "newsletter"),
        ),
      );
  });

  it("no source field configured → no rows and nothing unmapped", async () => {
    const res = await reconciliationByPlatform(null, D, D);
    expect(res.rows).toEqual([]);
    expect(res.unmappedValues).toEqual([]);
  });

  it("a mapping change moves orders between buckets", async () => {
    await db.insert(storeSourceMappings).values({
      accountId: ACCOUNT_A,
      rawValue: "newsletter",
      platform: "tiktok",
    });
    const r = (await reconciliationByPlatform("source", D, D)).rows[0]!;
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
    const r = (await reconciliationByPlatform("source", D, D)).rows[0]!;
    // B has no mapping for ig_ad → its lone order is Unattributed, not Instagram.
    expect(r.storeByPlatform.instagram ?? 0).toBe(0);
    expect(r.unattributed).toBe(1);
    expect(r.storeOrders).toBe(1);

    const ov = (await reconciliationOverview(D, D))[0]!;
    expect(ov.storeOrders).toBe(1);
    expect(ov.platformConv).toBe(0); // B has no ads data on D
  });
});

describe("reconciliation — the CHANNELS view", () => {
  it("buckets reconcile BY CONSTRUCTION: website + application + unmapped = store total", async () => {
    const res = await reconciliationByChannel(D, D);
    expect(res.rows).toHaveLength(1);
    const r = res.rows[0]!;
    // 6 web, 3 ios (→ Application), 1 kiosk (unmapped).
    expect(r.website).toBe(6);
    expect(r.application).toBe(3);
    expect(r.unmapped).toBe(1);
    expect(r.website + r.application + r.unmapped).toBe(r.storeOrders);
    expect(r.storeOrders).toBe(10); // the same total the overview reports
  });

  it("surfaces the unmapped channel values in range for the banner", async () => {
    const res = await reconciliationByChannel(D, D);
    expect(res.unmappedValues).toEqual(["kiosk"]);
  });

  it("both deltas, and unmapped absorbed into NEITHER", async () => {
    const r = (await reconciliationByChannel(D, D)).rows[0]!;
    const claimed = (await reconciliationOverview(D, D))[0]!.platformConv; // 7
    const d = channelDeltas({
      website: r.website,
      application: r.application,
      claimed,
    });
    // Inflation framing (claimed − actual):
    //   incl. app: 7 − (6 + 3) = −2
    //   excl. app: 7 − 6       = +1 — platforms over-claim against website alone
    expect(d.inclApp).toBe(-2);
    expect(d.exclApp).toBe(1);
    // The unmapped order is in NEITHER: absorbing it would have made incl. app
    // 7 − 10 = −3.
    expect(d.inclApp).not.toBe(claimed - r.storeOrders);
  });

  it("is account-scoped — B's orders and mappings never leak into A", async () => {
    setAccount(ACCOUNT_B);
    const res = await reconciliationByChannel(D, D);
    // B has one order with NO channel attribute at all → Unmapped, not Website.
    expect(res.rows[0]!.storeOrders).toBe(1);
    expect(res.rows[0]!.website).toBe(0);
    expect(res.rows[0]!.application).toBe(0);
    expect(res.rows[0]!.unmapped).toBe(1);
    // A's mappings are not visible from B.
    expect(await listStoreChannelMappings()).toEqual([]);
    setAccount(ACCOUNT_A);
    expect((await listStoreChannelMappings()).map((m) => m.rawValue).sort()).toEqual([
      "ios",
      "web",
    ]);
  });

  it("lists the distinct channel values for the config UI", async () => {
    const values = await distinctStoreChannelValues();
    expect(values.map((v) => v.value).sort()).toEqual(["ios", "kiosk", "web"]);
    expect(values.find((v) => v.value === "web")?.count).toBe(6);
  });
});

/**
 * The bug this pins: `/store/reconciliation` and `/store/orders` passed the RAW
 * optional search params to their queries, whose condition builders only bind
 * when a value is present — so a paramless visit ran LIFETIME while the picker
 * said "Last 7 days". The pages now resolve the range server-side and hand the
 * queries concrete bounds; these tests pin both halves of that contract.
 */
describe("range bounds bind — resolved vs absent", () => {
  const OUTSIDE = "2026-04-01"; // a month before the fixtures' isolated day D

  // This suite seeds once and never resets, so the out-of-range order is
  // inserted ONCE for the whole describe (a beforeEach would collide on the
  // unique order_id).
  beforeAll(async () => {
    setAccount(ACCOUNT_A);
    // One order well outside the day every other test uses.
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "out-of-range.csv",
      uploadedByUserId: UPLOADER,
      upsert: false,
      inserts: [
        {
          orderId: "OUT-1",
          orderDate: OUTSIDE,
          totalAmount: "100.00",
          attributes: { source: "ig_ad", channel: "web" },
        },
      ],
      updates: [],
    });
  });

  it("RESOLVED bounds exclude days outside the window", async () => {
    // What the page now passes: concrete from/to.
    const rows = await reconciliationOverview(D, D);
    expect(rows.map((r) => r.day)).toEqual([D]);
    expect(rows.find((r) => r.day === OUTSIDE)).toBeUndefined();

    const byChannel = await reconciliationByChannel(D, D);
    expect(byChannel.rows.map((r) => r.day)).toEqual([D]);

    const byPlatform = await reconciliationByPlatform("source", D, D);
    expect(byPlatform.rows.map((r) => r.day)).toEqual([D]);
  });

  it("ABSENT bounds mean LIFETIME — which is why the page must resolve first", async () => {
    // Exactly the old (buggy) call shape: no bounds at all. It is not "the
    // default window", it is every row the brand has.
    const rows = await reconciliationOverview(undefined, undefined);
    const days = rows.map((r) => r.day);
    expect(days).toContain(OUTSIDE);
    expect(days).toContain(D);

    const byChannel = await reconciliationByChannel(undefined, undefined);
    expect(byChannel.rows.map((r) => r.day)).toContain(OUTSIDE);
  });

  it("listStoreOrders honours the same contract", async () => {
    const bounded = await listStoreOrders({
      from: D,
      to: D,
      page: 1,
      sort: "order_date",
      dir: "desc",
    });
    expect(bounded.rows.every((r) => r.orderDate === D)).toBe(true);
    expect(bounded.rows.some((r) => r.orderId === "OUT-1")).toBe(false);

    // Unbounded: the paramless shape that made a fresh visit list everything.
    const unbounded = await listStoreOrders({
      page: 1,
      sort: "order_date",
      dir: "desc",
    });
    expect(unbounded.total).toBeGreaterThan(bounded.total);
    expect(unbounded.rows.some((r) => r.orderId === "OUT-1")).toBe(true);
  });
});
