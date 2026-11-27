import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { sql } from "drizzle-orm";
import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { storeOrderItems, storeOrders, storeSourceMappings } from "@/db/schema";
import {
  listStoreOrders,
  orderStageSql,
  storeOrderFilterOptions,
  storeOrderStageCounts,
  storeOrdersForExport,
  type StoreOrdersFilters,
} from "@/db/queries/store";
import { ORDER_STAGES, orderStatusStage } from "@/store/order-status";
import { UNATTRIBUTED } from "@/store/sources";
import { resetAndSeed } from "./fixtures";

// Store → Orders' search, status tabs and Filters dialog (2026-11-27).
// Pinned: the SQL stage IS `orderStatusStage`, the tab counts sum to the
// unfiltered listing and each equals what the tab lists, the search reaches
// the customer (phone by digits too) and treats wildcards literally, every
// filter narrows the listing AND the export alike, and all of it is
// account-scoped.

const D = "2026-06-01";
const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

let n = 0;
async function order(attributes: Record<string, string | number>, accountId = ACCOUNT_A, orderId?: string) {
  n += 1;
  const [row] = await db
    .insert(storeOrders)
    .values({ accountId, orderId: orderId ?? `O${n}`, orderDate: D, totalAmount: "100.00", attributes })
    .returning({ id: storeOrders.id });
  return row!.id;
}

const base: StoreOrdersFilters = { from: D, to: D, page: 1, sort: "order_date", dir: "desc" };
const ids = async (f: Partial<StoreOrdersFilters>) =>
  (await listStoreOrders({ ...base, ...f })).rows.map((r) => r.orderId).sort();

beforeAll(async () => {
  await resetAndSeed();
  await db.insert(storeSourceMappings).values([
    { accountId: ACCOUNT_A, rawValue: "tt", platform: "tiktok" },
  ]);
  const a = await order(
    {
      customer_name: "Sara Al-Harbi",
      phone: "+966501234567",
      email: "sara@example.com",
      order_status: "delivered",
      payment_method: "cod",
      payment_type: "cod",
      utm_source: "tt",
      coupon_code: "SAVE10",
      offers: "Buy 2 get 1, Free ship",
    },
    ACCOUNT_A,
    "2148830",
  );
  await order({ customer_name: "Fahad", order_status: "canceled", payment_method: "mada", tracking_number: "TRK_9_99" });
  await order({ order_status: "shipped", payment_method: "tamara_installment", offers: "Free ship" });
  await order({ order_status: "payment_pending" });
  await order({}); // an uploaded order — no status
  await order({ customer_name: "Sara Other", phone: "+966509999999" }, ACCOUNT_B);
  await db.insert(storeOrderItems).values([
    { accountId: ACCOUNT_A, storeOrderId: a, position: 0, sku: "SKU-A", name: "Watch", quantity: 1, lineTotalSar: "100.00" },
  ]);
});

beforeEach(() => setAccount(ACCOUNT_A));

describe("the SQL stage", () => {
  it("matches orderStatusStage for every known slug, an unknown one and none", async () => {
    const slugs = [
      "payment_pending", "under_review", "in_progress", "completed", "shipped", "delivering",
      "delivered", "canceled", "restoring", "restored", "deleted", "brand_new_slug", "", " Delivered ",
    ];
    for (const s of slugs) {
      const [r] = await db.execute<{ stage: string }>(sql`
        SELECT ${orderStageSql} AS stage
          FROM (SELECT ${JSON.stringify({ order_status: s })}::jsonb AS attributes) AS store_orders
      `);
      expect({ s, stage: r!.stage }).toEqual({ s, stage: orderStatusStage(s) });
    }
  });
});

describe("status tabs", () => {
  it("count every stage under the same filters, summing to the listing", async () => {
    const counts = await storeOrderStageCounts(base);
    const all = (await listStoreOrders(base)).total;
    expect(ORDER_STAGES.reduce((a, s) => a + counts[s], 0)).toBe(all);
    expect(counts).toMatchObject({ delivered: 1, cancelled: 1, on_the_way: 1, awaiting: 1, none: 1 });
    for (const s of ORDER_STAGES) {
      expect((await listStoreOrders({ ...base, stage: s })).total).toBe(counts[s]);
    }
  });

  it("ignore the tab itself, but follow the other filters", async () => {
    const counts = await storeOrderStageCounts({ ...base, stage: "delivered", payments: ["mada"] });
    expect(counts.cancelled).toBe(1);
    expect(counts.delivered).toBe(0);
  });
});

describe("search", () => {
  it("reaches the order and the customer", async () => {
    expect(await ids({ q: "#2148830" })).toEqual(["2148830"]);
    expect(await ids({ q: "sara" })).toEqual(["2148830"]);
    expect(await ids({ q: "EXAMPLE.COM" })).toEqual(["2148830"]);
    expect(await ids({ q: "save10" })).toEqual(["2148830"]);
  });

  it("finds a phone typed locally or with spaces", async () => {
    expect(await ids({ q: "0501234567" })).toEqual(["2148830"]);
    expect(await ids({ q: "+966 50 123 4567" })).toEqual(["2148830"]);
    expect(await ids({ q: "1234567" })).toEqual(["2148830"]);
  });

  it("treats % and _ literally", async () => {
    expect(await ids({ q: "TRK_9" })).toHaveLength(1);
    expect(await ids({ q: "%" })).toEqual([]);
  });

  it("is account-scoped", async () => {
    setAccount(ACCOUNT_B);
    expect(await ids({ q: "sara" })).toHaveLength(1);
  });
});

describe("filters", () => {
  it("each narrows the listing", async () => {
    expect(await ids({ payments: ["cod", "mada"] })).toHaveLength(2);
    expect(await ids({ paymentTypes: ["cod"] })).toEqual(["2148830"]);
    expect(await ids({ platforms: ["tiktok"] })).toEqual(["2148830"]);
    expect(await ids({ platforms: [UNATTRIBUTED] })).toHaveLength(4);
    expect(await ids({ skus: ["SKU-A"] })).toEqual(["2148830"]);
    expect(await ids({ coupons: ["SAVE10"] })).toEqual(["2148830"]);
    // one offer of several joined with ", "
    expect(await ids({ offers: ["Free ship"] })).toHaveLength(2);
  });

  it("narrow the export the same way", async () => {
    const { rows } = await storeOrdersForExport({ ...base, payments: ["mada"], stage: "cancelled" });
    expect(rows.map((r) => r.attributes.customer_name)).toEqual(["Fahad"]);
  });
});

describe("storeOrderFilterOptions", () => {
  it("offers the brand's own values, splitting joined offers", async () => {
    const o = await storeOrderFilterOptions();
    expect(o.payments.sort()).toEqual(["cod", "mada", "tamara_installment"]);
    expect(o.coupons).toEqual(["SAVE10"]);
    expect(o.offers.sort()).toEqual(["Buy 2 get 1", "Free ship"]);
    expect(o.products).toEqual([{ key: "SKU-A", name: "Watch" }]);
  });
});
