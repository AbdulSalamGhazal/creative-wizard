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
  storeInsightsBreakdown,
  storeInsightsDaily,
} from "@/db/queries/store-insights";
import {
  reconciliationByChannel,
  reconciliationByPlatform,
} from "@/db/queries/reconciliation";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import { CHANNEL_LENS, PLATFORM_LENS } from "@/lib/store-insights";
import { resetAndSeed } from "./fixtures";

// Store Insights reads `store_orders` and NOTHING else (standing decision:
// store facts only, SAR only). What's pinned here: the two scans agree on the
// same set of orders, every order lands in exactly one bucket (including the
// explicit blank one), and the two mapped lenses bucket EXACTLY as
// Reconciliation does — same mappings, same sentinels — so the two pages can
// never tell different stories about the same day.

const UPLOADER = "dddddddd-0000-0000-0000-0000000000f1";
const D1 = "2026-06-01";
const D2 = "2026-06-02";
const OUTSIDE = "2026-07-15";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

/** An order; a missing key is a column the file never had (vs. a blank cell). */
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
    email: "insights-uploader@store.test",
    name: "Uploader",
    role: "editor",
  });

  await writeStoreBatch({
    accountId: ACCOUNT_A,
    fileName: "insights.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [
      order("I1", D1, "100.00", { utm_source: "ig_ad", channel: "web", coupon: "SAVE10" }),
      order("I2", D1, "200.00", { utm_source: "ig_ad", channel: "web", coupon: "SAVE10" }),
      order("I3", D1, "50.00", { utm_source: "fb_ad", channel: "ios" }),
      order("I4", D1, "75.00", { utm_source: "newsletter", channel: "web" }),
      // A BLANK cell on both axes…
      order("I5", D1, "25.00", { utm_source: "", channel: "kiosk" }),
      // …and a row whose file had neither column at all. Both are "no value".
      order("I6", D1, "10.00", {}),
      order("I7", D2, "40.00", { utm_source: "ig_ad", channel: "ios" }),
      // Outside every range the tests ask for.
      order("I8", OUTSIDE, "999.00", { utm_source: "ig_ad", channel: "web" }),
    ],
    updates: [],
  });

  await db.insert(storeSourceMappings).values([
    { accountId: ACCOUNT_A, rawValue: "ig_ad", platform: "instagram" },
    { accountId: ACCOUNT_A, rawValue: "fb_ad", platform: "facebook" },
  ]);
  await db.insert(storeChannelMappings).values([
    { accountId: ACCOUNT_A, rawValue: "web", destination: "website" },
    { accountId: ACCOUNT_A, rawValue: "ios", destination: "application" },
  ]);

  // Brand B: the SAME raw values, no mappings of its own.
  await writeStoreBatch({
    accountId: ACCOUNT_B,
    fileName: "insights-b.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [order("B1", D1, "500.00", { utm_source: "ig_ad", channel: "web" })],
    updates: [],
  });
});

beforeEach(() => setAccount(ACCOUNT_A));

/** Orders by bucket, as a plain object — `null` is the blank bucket. */
const byValue = (rows: Array<{ value: string | null; orders: number }>) =>
  Object.fromEntries(rows.map((r) => [r.value ?? "__blank__", r.orders]));

describe("storeInsightsDaily", () => {
  it("returns one row per day with data, bounded by the range", async () => {
    const rows = await storeInsightsDaily(D1, D2);
    expect(rows.map((r) => r.day)).toEqual([D1, D2]);
    expect(rows[0]!.orders).toBe(6);
    expect(rows[0]!.revenue).toBeCloseTo(460, 2); // 100+200+50+75+25+10
    expect(rows[1]!.orders).toBe(1);
    expect(rows[1]!.revenue).toBeCloseTo(40, 2);
  });

  it("never reaches outside the range", async () => {
    const rows = await storeInsightsDaily(D1, D1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orders).toBe(6);
  });

  it("is account-scoped — brand B sees only its own order", async () => {
    setAccount(ACCOUNT_B);
    const rows = await storeInsightsDaily(D1, D2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orders).toBe(1);
    expect(rows[0]!.revenue).toBeCloseTo(500, 2);
  });
});

describe("storeInsightsBreakdown — grouping and the blank bucket", () => {
  it("groups a field's own values, with blanks in ONE explicit bucket", async () => {
    const { rows } = await storeInsightsBreakdown(STORE_SOURCE_FIELD_KEY, D1, D1);
    expect(byValue(rows)).toEqual({
      ig_ad: 2,
      fb_ad: 1,
      newsletter: 1,
      // A blank cell and an absent column are the same answer: "no value".
      __blank__: 2,
    });
  });

  it("sums back to the range total — values + blank, by construction", async () => {
    const [daily, { rows }] = await Promise.all([
      storeInsightsDaily(D1, D2),
      storeInsightsBreakdown(STORE_SOURCE_FIELD_KEY, D1, D2),
    ]);
    const total = daily.reduce((a, d) => a + d.orders, 0);
    const revenue = daily.reduce((a, d) => a + d.revenue, 0);
    expect(rows.reduce((a, r) => a + r.orders, 0)).toBe(total);
    expect(rows.reduce((a, r) => a + r.revenue, 0)).toBeCloseTo(revenue, 2);
  });

  it("carries revenue per value, in SAR", async () => {
    const { rows } = await storeInsightsBreakdown(STORE_SOURCE_FIELD_KEY, D1, D1);
    const ig = rows.find((r) => r.value === "ig_ad")!;
    expect(ig.revenue).toBeCloseTo(300, 2);
  });

  it("groups a CUSTOM field the same way (present on two orders only)", async () => {
    const { rows } = await storeInsightsBreakdown("coupon", D1, D1);
    expect(byValue(rows)).toEqual({ SAVE10: 2, __blank__: 4 });
  });

  it("reports the distinct-value count for the top-N note", async () => {
    const { rows, totalValues } = await storeInsightsBreakdown(
      STORE_SOURCE_FIELD_KEY,
      D1,
      D1,
    );
    expect(totalValues).toBe(rows.length);
    expect(totalValues).toBe(4); // ig_ad, fb_ad, newsletter, blank
  });

  it("is account-scoped", async () => {
    setAccount(ACCOUNT_B);
    const { rows } = await storeInsightsBreakdown(STORE_SOURCE_FIELD_KEY, D1, D1);
    expect(byValue(rows)).toEqual({ ig_ad: 1 });
  });
});

describe("the two lenses bucket EXACTLY as Reconciliation does", () => {
  it("platform lens = reconciliationByPlatform's buckets over the range", async () => {
    const [{ rows }, recon] = await Promise.all([
      storeInsightsBreakdown(PLATFORM_LENS, D1, D2),
      reconciliationByPlatform(STORE_SOURCE_FIELD_KEY, D1, D2),
    ]);
    // Sum Reconciliation's per-day rows over the same range.
    const expected: Record<string, number> = {};
    for (const day of recon.rows) {
      for (const [p, n] of Object.entries(day.storeByPlatform)) {
        expected[p] = (expected[p] ?? 0) + n;
      }
      if (day.unattributed > 0) {
        expected[UNATTRIBUTED] = (expected[UNATTRIBUTED] ?? 0) + day.unattributed;
      }
    }
    expect(byValue(rows)).toEqual(expected);
    // …and concretely: unmapped, blank and absent all land in Unattributed.
    expect(expected).toEqual({ instagram: 3, facebook: 1, [UNATTRIBUTED]: 3 });
  });

  it("channel lens = reconciliationByChannel's buckets over the range", async () => {
    const [{ rows }, recon] = await Promise.all([
      storeInsightsBreakdown(CHANNEL_LENS, D1, D2),
      reconciliationByChannel(D1, D2),
    ]);
    const expected = recon.rows.reduce(
      (a, r) => ({
        website: a.website + r.website,
        application: a.application + r.application,
        [UNMAPPED_CHANNEL]: a[UNMAPPED_CHANNEL] + r.unmapped,
      }),
      { website: 0, application: 0, [UNMAPPED_CHANNEL]: 0 },
    );
    expect(byValue(rows)).toEqual(expected);
    expect(expected).toEqual({ website: 3, application: 2, [UNMAPPED_CHANNEL]: 2 });
  });

  it("a brand with no mappings reads as entirely unattributed/unmapped", async () => {
    setAccount(ACCOUNT_B);
    const [platform, channel] = await Promise.all([
      storeInsightsBreakdown(PLATFORM_LENS, D1, D1),
      storeInsightsBreakdown(CHANNEL_LENS, D1, D1),
    ]);
    expect(byValue(platform.rows)).toEqual({ [UNATTRIBUTED]: 1 });
    expect(byValue(channel.rows)).toEqual({ [UNMAPPED_CHANNEL]: 1 });
  });
});

describe("filters apply to BOTH scans", () => {
  it("a platform filter narrows the series and the breakdown alike", async () => {
    const f = { platforms: ["instagram"] };
    const [daily, { rows }] = await Promise.all([
      storeInsightsDaily(D1, D2, f),
      storeInsightsBreakdown(CHANNEL_LENS, D1, D2, f),
    ]);
    expect(daily.reduce((a, d) => a + d.orders, 0)).toBe(3); // I1, I2, I7
    expect(byValue(rows)).toEqual({ website: 2, application: 1 });
  });

  it("a channel filter does the same", async () => {
    const f = { channels: ["application"] };
    const [daily, { rows }] = await Promise.all([
      storeInsightsDaily(D1, D2, f),
      storeInsightsBreakdown(PLATFORM_LENS, D1, D2, f),
    ]);
    expect(daily.reduce((a, d) => a + d.orders, 0)).toBe(2); // I3, I7
    expect(byValue(rows)).toEqual({ facebook: 1, instagram: 1 });
  });

  it("the two filters AND together, and the sentinels are selectable", async () => {
    const both = await storeInsightsDaily(D1, D2, {
      platforms: ["instagram"],
      channels: ["website"],
    });
    expect(both.reduce((a, d) => a + d.orders, 0)).toBe(2); // I1, I2

    const unattributed = await storeInsightsDaily(D1, D2, {
      platforms: [UNATTRIBUTED],
    });
    expect(unattributed.reduce((a, d) => a + d.orders, 0)).toBe(3); // I4, I5, I6
  });

  it("a filtered breakdown still sums to its own filtered total", async () => {
    const f = { platforms: ["instagram", "facebook"] };
    const [daily, { rows }] = await Promise.all([
      storeInsightsDaily(D1, D2, f),
      storeInsightsBreakdown(STORE_SOURCE_FIELD_KEY, D1, D2, f),
    ]);
    const total = daily.reduce((a, d) => a + d.orders, 0);
    expect(rows.reduce((a, r) => a + r.orders, 0)).toBe(total);
    expect(total).toBe(4);
  });
});
