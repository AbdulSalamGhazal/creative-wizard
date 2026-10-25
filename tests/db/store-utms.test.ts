import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { storeChannelMappings, storeSourceMappings, users } from "@/db/schema";
import { writeStoreBatch } from "@/db/queries/store";
import {
  utmClaimedDaily,
  utmDailyByBucket,
  utmSourceBreakdown,
  utmSourceDaily,
} from "@/db/queries/store-utms";
import { reconciliationByPlatform } from "@/db/queries/reconciliation";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { NO_SOURCE, OTHER_SOURCE, UNMAPPED_SOURCE } from "@/store/sources";
import { isPlatformBucket } from "@/lib/store-utms";
import { resetAndSeed } from "./fixtures";

/**
 * The UTMs page reads `store_orders` through the SAME unique mappings
 * Reconciliation uses. Pinned here: its platform buckets equal
 * `reconciliationByPlatform`'s per day; its three unknowns (no source ·
 * unmapped · other) sum to Reconciliation's Unattributed per day; every scan
 * reconciles to the day's total; the ads side equals Reconciliation's claimed
 * side under both Excluded states; and nothing leaks across brands.
 */

const UPLOADER = "dddddddd-0000-0000-0000-0000000000f2";
// The fixtures' performance rows live on these days, so one range covers both sides.
const D1 = "2026-01-01";
const D2 = "2026-01-02";
const D3 = "2026-01-03";
const OUTSIDE = "2026-02-15";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

const order = (
  orderId: string,
  orderDate: string,
  totalAmount: string,
  attrs: Record<string, string>,
) => ({ orderId, orderDate, totalAmount, attributes: attrs });

beforeAll(async () => {
  await resetAndSeed();
  await db.insert(users).values({
    id: UPLOADER,
    email: "utms-uploader@store.test",
    name: "Uploader",
    role: "editor",
  });

  await writeStoreBatch({
    accountId: ACCOUNT_A,
    fileName: "utms.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [
      // D1: 2 instagram (one web, one app), 1 facebook, 1 "not an ad platform",
      // 1 unmapped value, 1 blank cell, 1 absent column.
      order("U1", D1, "100.00", { utm_source: "ig_ad", channel: "web" }),
      order("U2", D1, "200.00", { utm_source: "ig_ad", channel: "ios" }),
      order("U3", D1, "50.00", { utm_source: "fb_ad", channel: "web" }),
      order("U4", D1, "75.00", { utm_source: "newsletter", channel: "web" }),
      order("U5", D1, "30.00", { utm_source: "Insta gram", channel: "web" }),
      order("U6", D1, "25.00", { utm_source: "", channel: "web" }),
      order("U7", D1, "10.00", {}),
      // D2: one more instagram; D3: one unmapped.
      order("U8", D2, "40.00", { utm_source: "ig_ad", channel: "web" }),
      order("U9", D3, "60.00", { utm_source: "Insta gram", channel: "ios" }),
      // Outside every range the tests ask for.
      order("U10", OUTSIDE, "999.00", { utm_source: "ig_ad", channel: "web" }),
    ],
    updates: [],
  });

  await db.insert(storeSourceMappings).values([
    { accountId: ACCOUNT_A, rawValue: "ig_ad", platform: "instagram" },
    { accountId: ACCOUNT_A, rawValue: "fb_ad", platform: "facebook" },
    // Explicitly "not an ad platform".
    { accountId: ACCOUNT_A, rawValue: "newsletter", platform: null },
  ]);
  await db.insert(storeChannelMappings).values([
    { accountId: ACCOUNT_A, rawValue: "web", destination: "website" },
    { accountId: ACCOUNT_A, rawValue: "ios", destination: "application" },
  ]);

  // Brand B: the SAME raw values, no mappings of its own.
  await writeStoreBatch({
    accountId: ACCOUNT_B,
    fileName: "utms-b.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [order("B1", D1, "500.00", { utm_source: "ig_ad", channel: "web" })],
    updates: [],
  });
});

beforeEach(() => setAccount(ACCOUNT_A));

/** day → bucket → orders, from the per-day scan. */
const pivot = (rows: Array<{ day: string; bucket: string; orders: number }>) => {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.day] ??= {})[r.bucket] = r.orders;
  return out;
};

describe("utmDailyByBucket", () => {
  it("splits each day into platforms and the three unknowns, summing to the day's total", async () => {
    const rows = await utmDailyByBucket(D1, D3);
    expect(pivot(rows)).toEqual({
      [D1]: { instagram: 2, facebook: 1, [OTHER_SOURCE]: 1, [UNMAPPED_SOURCE]: 1, [NO_SOURCE]: 2 },
      [D2]: { instagram: 1 },
      [D3]: { [UNMAPPED_SOURCE]: 1 },
    });
    const d1 = rows.filter((r) => r.day === D1);
    expect(d1.reduce((a, r) => a + r.orders, 0)).toBe(7);
    expect(d1.reduce((a, r) => a + r.revenue, 0)).toBeCloseTo(490, 2);
  });

  it("buckets EXACTLY as Reconciliation does: same platforms, unknowns = Unattributed", async () => {
    const [rows, recon] = await Promise.all([
      utmDailyByBucket(D1, D3),
      reconciliationByPlatform(STORE_SOURCE_FIELD_KEY, D1, D3),
    ]);
    const mine = pivot(rows);
    for (const day of recon.rows) {
      const m = mine[day.day] ?? {};
      const platforms = Object.fromEntries(
        Object.entries(m).filter(([b]) => isPlatformBucket(b)),
      );
      expect(platforms).toEqual(day.storeByPlatform);
      const unknown = (m[NO_SOURCE] ?? 0) + (m[UNMAPPED_SOURCE] ?? 0) + (m[OTHER_SOURCE] ?? 0);
      expect(unknown).toBe(day.unattributed);
      expect(Object.values(m).reduce((a, n) => a + n, 0)).toBe(day.storeOrders);
    }
    // The unmapped set is the same one Reconciliation's banner counts.
    expect(recon.unmappedValues).toEqual(["Insta gram"]);
  });

  it("never reaches outside the range and is account-scoped", async () => {
    expect((await utmDailyByBucket(D2, D2)).map((r) => r.day)).toEqual([D2]);
    setAccount(ACCOUNT_B);
    const rows = await utmDailyByBucket(D1, D3);
    // Brand B has no mapping for ig_ad, so its one order is Unmapped there.
    expect(pivot(rows)).toEqual({ [D1]: { [UNMAPPED_SOURCE]: 1 } });
  });
});

describe("utmSourceBreakdown", () => {
  it("groups by raw value with its bucket and the channel split, largest first", async () => {
    const { rows, totalValues } = await utmSourceBreakdown(D1, D3);
    // Largest first; ties are broken here, since SQL leaves their order open.
    const tieBroken = [...rows].sort(
      (a, b) => b.orders - a.orders || (a.value ?? "").localeCompare(b.value ?? ""),
    );
    expect(rows[0]!.value).toBe("ig_ad");
    expect(tieBroken.map((r) => [r.value, r.bucket, r.orders, r.website, r.application])).toEqual([
      ["ig_ad", "instagram", 3, 2, 1],
      // Blank cell + absent column = one bucket, two orders.
      [null, NO_SOURCE, 2, 1, 0],
      ["Insta gram", UNMAPPED_SOURCE, 2, 1, 1],
      ["fb_ad", "facebook", 1, 1, 0],
      ["newsletter", OTHER_SOURCE, 1, 1, 0],
    ]);
    expect(totalValues).toBe(5);
    expect(rows.reduce((a, r) => a + r.orders, 0)).toBe(9);
    expect(rows.find((r) => r.value === "ig_ad")!.revenue).toBeCloseTo(340, 2);
  });

  it("is account-scoped", async () => {
    setAccount(ACCOUNT_B);
    const { rows } = await utmSourceBreakdown(D1, D3);
    expect(rows).toEqual([
      { value: "ig_ad", bucket: UNMAPPED_SOURCE, orders: 1, revenue: 500, website: 0, application: 0 },
    ]);
  });
});

describe("utmSourceDaily", () => {
  it("returns per-day rows for the asked values only, blank included on request", async () => {
    const rows = await utmSourceDaily(D1, D3, ["ig_ad", null]);
    expect(rows.map((r) => [r.day, r.value, r.orders])).toEqual([
      [D1, "ig_ad", 2],
      [D1, null, 2],
      [D2, "ig_ad", 1],
    ]);
  });

  it("is empty when nothing is asked for, and bounded by the range", async () => {
    expect(await utmSourceDaily(D1, D3, [])).toEqual([]);
    expect(await utmSourceDaily(D3, D3, ["ig_ad"])).toEqual([]);
    expect((await utmSourceDaily(D3, D3, ["Insta gram"])).map((r) => r.orders)).toEqual([1]);
  });
});

describe("utmClaimedDaily", () => {
  it("equals Reconciliation's claimed side per day per platform, honouring Excluded", async () => {
    for (const includeExcluded of [false, true]) {
      const [claimed, recon] = await Promise.all([
        utmClaimedDaily(D1, D3, includeExcluded),
        reconciliationByPlatform(STORE_SOURCE_FIELD_KEY, D1, D3, includeExcluded),
      ]);
      const mine: Record<string, Record<string, number>> = {};
      for (const c of claimed) (mine[c.day] ??= {})[c.platform] = c.conversions;
      for (const day of recon.rows) {
        expect(mine[day.day] ?? {}).toEqual(day.claimedByPlatform);
      }
    }
    // Concretely: the fixtures' excluded instagram row (100) counts only on opt-in.
    const hidden = await utmClaimedDaily(D1, D3, false);
    expect(hidden.map((r) => [r.day, r.platform, r.conversions])).toEqual([
      [D1, "facebook", 20],
      [D1, "instagram", 10],
      [D2, "instagram", 10],
    ]);
    const shown = await utmClaimedDaily(D1, D3, true);
    expect(shown.find((r) => r.day === D3)).toEqual({ day: D3, platform: "instagram", conversions: 100 });
  });

  it("is account-scoped", async () => {
    setAccount(ACCOUNT_B);
    const rows = await utmClaimedDaily(D1, D3, false);
    expect(rows).toEqual([{ day: D1, platform: "instagram", conversions: 7 }]);
  });
});
