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
import {
  storeOrderItems,
  storeOrders,
  storeProductCosts,
  storeSourceMappings,
} from "@/db/schema";
import {
  IS_CANCELLED_SQL,
  IS_REFUNDED_SQL,
  storeInsightsDaily,
  storeInsightsKpis,
  storeInsightsProducts,
  storeInsightsSections,
} from "@/db/queries/store-insights";
import { orderStatusTone } from "@/store/order-status";
import { SECTION_LENS_KEYS, foldSection, grossProfit } from "@/lib/store-insights";
import { resetAndSeed } from "./fixtures";

// The decision sections (2026-11-27). Pinned: every scan reads the SAME
// filtered set as the trend (so the tiles and sections agree), every section's
// rows fold back to the range total, the SQL status stage is
// `orderStatusTone`'s, "returning" sees orders BEFORE the range, and gross
// profit counts only costed lines.

const D0 = "2026-05-20"; // before the range
const D1 = "2026-06-01";
const D2 = "2026-06-02";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

let seq = 0;
async function order(
  orderDate: string,
  total: string,
  attributes: Record<string, string | number>,
  accountId = ACCOUNT_A,
): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(storeOrders)
    .values({
      accountId,
      orderId: `S${seq}`,
      orderDate,
      totalAmount: total,
      attributes,
      // created_at orders same-day arrivals for the returning rank
      createdAt: new Date(Date.parse(`${orderDate}T08:00:00Z`) + seq * 1000),
    })
    .returning({ id: storeOrders.id });
  return row!.id;
}

beforeAll(async () => {
  await resetAndSeed();
  await db.insert(storeSourceMappings).values([
    { accountId: ACCOUNT_A, rawValue: "tt", platform: "tiktok" },
  ]);

  // Customer +966500000001 ordered BEFORE the range → returning in range.
  await order(D0, "100.00", { phone: "+966500000001", utm_source: "tt" });
  const o1 = await order(D1, "300.00", {
    phone: "+966500000001",
    utm_source: "tt",
    payment_method: "cod",
    order_status: "canceled",
    city: "Riyadh",
    coupon_code: "SAVE10",
    coupon_discount: 20,
  });
  // A brand-new customer who orders twice in range: new, then returning.
  const o2 = await order(D1, "200.00", {
    phone: "+966500000002",
    utm_source: "tt",
    payment_method: "mada",
    order_status: "delivered",
    delivered_date: "2026-06-04",
    city: "Jeddah",
  });
  await order(D2, "150.00", {
    salla_customer_id: "777",
    payment_method: "tamara_installment",
    order_status: "restored",
    city: "Riyadh",
    offers: "Buy 2 get 1",
    offers_discount: 50,
  });
  await order(D2, "50.00", { phone: "+966500000002", payment_method: "mada", order_status: "shipped" });
  // No customer key, no payment method: the "not reported" buckets.
  await order(D2, "10.00", {});

  // Another brand's order on the same day — never seen.
  await order(D1, "999.00", { phone: "+966500000001", payment_method: "cod" }, ACCOUNT_B);

  await db.insert(storeOrderItems).values([
    // o1: 1 × SKU-A, costed (cancelled order → lost units)
    { accountId: ACCOUNT_A, storeOrderId: o1, position: 0, sku: "SKU-A", name: "A", quantity: 1, lineTotalSar: "230.00", unitPriceSar: "200.00", originalUnitPriceSar: "250.00" },
    // o2: 2 × SKU-A costed + 1 × SKU-B with no cost
    { accountId: ACCOUNT_A, storeOrderId: o2, position: 0, sku: "SKU-A", name: "A", quantity: 2, lineTotalSar: "115.00", unitPriceSar: "50.00", originalUnitPriceSar: "50.00" },
    { accountId: ACCOUNT_A, storeOrderId: o2, position: 1, sku: "SKU-B", name: "B", quantity: 1, lineTotalSar: "85.00" },
  ]);
  await db.insert(storeProductCosts).values([
    { accountId: ACCOUNT_A, productKey: "SKU-A", unitCostSar: "40.00", effectiveFrom: "2026-01-01" },
  ]);
});

beforeEach(() => setAccount(ACCOUNT_A));

describe("the SQL status stage", () => {
  it("matches orderStatusTone for every known slug and an unknown one", async () => {
    const slugs = [
      "payment_pending", "under_review", "in_progress", "completed", "shipped",
      "delivering", "delivered", "canceled", "restoring", "restored", "deleted",
      "something_new", "",
    ];
    for (const s of slugs) {
      const [r] = await db.execute<{ c: boolean; r: boolean }>(sql`
        SELECT ${IS_CANCELLED_SQL} AS c, ${IS_REFUNDED_SQL} AS r
          FROM (SELECT ${JSON.stringify({ order_status: s })}::jsonb AS attributes) AS store_orders
      `);
      const tone = orderStatusTone(s);
      expect({ s, c: r!.c, r: r!.r }).toEqual({ s, c: tone === "neg", r: tone === "warn" });
    }
  });
});

describe("storeInsightsKpis", () => {
  it("agrees with the daily series and counts statuses as flags only", async () => {
    const [k, daily] = await Promise.all([storeInsightsKpis(D1, D2), storeInsightsDaily(D1, D2)]);
    expect(k.orders).toBe(daily.reduce((a, d) => a + d.orders, 0));
    expect(k.revenue).toBeCloseTo(daily.reduce((a, d) => a + d.revenue, 0), 2);
    expect(k.orders).toBe(5);
    expect(k.cancelled).toBe(1);
    expect(k.refunded).toBe(1);
  });

  it("sees a customer's order BEFORE the range: returning vs new", async () => {
    const k = await storeInsightsKpis(D1, D2);
    // returning: o1 (ordered D0) and the +…002 second order
    expect(k.returningOrders).toBe(2);
    expect(k.returningRevenue).toBeCloseTo(350, 2);
    // new: o2 and the salla-id-only customer
    expect(k.newOrders).toBe(2);
    expect(k.unknownCustomerOrders).toBe(1);
    expect(k.newOrders + k.returningOrders + k.unknownCustomerOrders).toBe(k.orders);
    expect(k.customers).toBe(3);
    expect(k.repeatCustomers).toBe(1);
    expect(k.historyFrom).toBe(D0);
  });

  it("sums promos", async () => {
    const k = await storeInsightsKpis(D1, D2);
    expect(k.couponOrders).toBe(1);
    expect(k.couponDiscount).toBeCloseTo(20, 2);
    expect(k.offerOrders).toBe(1);
    expect(k.offerDiscount).toBeCloseTo(50, 2);
  });

  it("applies the platform filter like the trend", async () => {
    const k = await storeInsightsKpis(D1, D2, { platforms: ["tiktok"] });
    expect(k.orders).toBe(2);
  });

  it("is account-scoped", async () => {
    setAccount(ACCOUNT_B);
    const k = await storeInsightsKpis(D1, D2);
    expect(k.orders).toBe(1);
    expect(k.returningOrders).toBe(0);
  });
});

describe("storeInsightsSections", () => {
  it("every lens folds back to the range total", async () => {
    const { lenses, total } = await storeInsightsSections(D1, D2);
    expect(total.orders).toBe(5);
    for (const k of SECTION_LENS_KEYS) {
      const rows = foldSection(lenses[k], total);
      expect(rows.reduce((a, r) => a + r.orders, 0)).toBe(total.orders);
      expect(rows.reduce((a, r) => a + r.revenue, 0)).toBeCloseTo(total.revenue, 2);
    }
  });

  it("carries lost orders and delivery days per value, blanks as their own bucket", async () => {
    const { lenses } = await storeInsightsSections(D1, D2);
    const pay = Object.fromEntries(lenses.payment.map((r) => [r.value ?? "__blank__", r]));
    expect(pay.cod!.lost).toBe(1);
    expect(pay.mada!.orders).toBe(2);
    expect(pay.mada!.delivered).toBe(1);
    expect(pay.mada!.deliveryDays).toBe(3);
    expect(pay.__blank__!.orders).toBe(1);
    const city = Object.fromEntries(lenses.city.map((r) => [r.value ?? "__blank__", r.orders]));
    expect(city).toEqual({ Riyadh: 2, Jeddah: 1, __blank__: 2 });
  });
});

describe("storeInsightsProducts", () => {
  it("prices gross profit on costed lines only, before VAT", async () => {
    const p = await storeInsightsProducts(D1, D2);
    expect(p.total.units).toBe(4);
    expect(p.total.unitsWithoutCost).toBe(1);
    // costed lines: 230 + 115 incl. VAT → 300 ex VAT; cogs 3 × 40
    expect(p.total.costedSalesExVat).toBeCloseTo(300, 2);
    expect(p.total.cogs).toBeCloseTo(120, 2);
    expect(grossProfit(p.total).profit).toBeCloseTo(180, 2);
    expect(p.total.markdown).toBeCloseTo(50, 2);
    const a = p.rows.find((r) => r.key === "SKU-A")!;
    expect(a.units).toBe(3);
    expect(a.lostUnits).toBe(1);
    expect(p.ordersWithoutProducts).toBe(3);
  });

  it("follows the filters", async () => {
    const p = await storeInsightsProducts(D1, D2, { platforms: ["unattributed"] });
    expect(p.total.units).toBe(0);
  });
});
