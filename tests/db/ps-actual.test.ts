import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import {
  creatives,
  performanceRecords,
  products,
  psSkuOfferMappings,
  storeOrderItems,
  storeOrders,
  storeProductCosts,
} from "@/db/schema";
import {
  actualFacts,
  actualMappings,
  setAdProduct,
  setSkuOffer,
  setSkuProduct,
} from "@/db/queries/price-structure-actual";
import { computeActual } from "@/price-structure/actual/engine";
import { skuOfferKey } from "@/price-structure/actual/facts";
import { sampleVersionData } from "@/price-structure/engine/sample";
import { resetAndSeed } from "./fixtures";

// Pricing · Actual (2026-11-27). Pinned against the real database: every
// order's money splits as Salla's identity says (net = total − VAT; product =
// sub_total − discount; fees = the rest), the LINES foot exactly to the
// product money, outcomes follow the Store's own status stages, a lost line
// needs no cost, the delivery rate reads only closed FEED orders of the
// window, ad spend is the raw sum by the creative's product, and the
// mappings are per brand.

const FROM = "2026-06-01";
const TO = "2026-06-30";
const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

let seq = 0;
async function order(
  orderDate: string,
  total: string,
  attributes: Record<string, string | number>,
  { accountId = ACCOUNT_A, feed = true }: { accountId?: string; feed?: boolean } = {},
): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(storeOrders)
    .values({
      accountId,
      orderId: `PA${seq}`,
      orderDate,
      totalAmount: total,
      attributes,
      connectorUpdatedAt: feed ? new Date("2026-06-30T00:00:00Z") : null,
    })
    .returning({ id: storeOrders.id });
  return row!.id;
}
const item = (storeOrderId: string, position: number, sku: string, quantity: number, lineTotalSar: string) => ({
  accountId: ACCOUNT_A,
  storeOrderId,
  position,
  sku,
  name: sku,
  quantity,
  lineTotalSar,
});

beforeAll(async () => {
  await resetAndSeed();
  // A real Salla order (2026-11-27): 260 − 13 coupon + 8.70 COD = 255.70; VAT 38.35; total 294.05.
  const o1 = await order("2026-06-01", "294.05", {
    payment_method: "cod",
    order_status: "delivered",
    subtotal: 260,
    discount: 13,
    shipping_fee: 0,
    cod_fee: 8.7,
    vat: 38.35,
  });
  // Two SKUs, prepaid, still on the way: open.
  const o2 = await order("2026-06-02", "575.00", {
    payment_method: "mada",
    order_status: "delivering",
    subtotal: 480,
    discount: 0,
    shipping_fee: 20,
    cod_fee: 0,
    vat: 75,
  });
  // Cancelled: lost — its SKU has no cost, which must not matter.
  const o3 = await order("2026-06-03", "115.00", { payment_method: "cod", order_status: "canceled", subtotal: 100, discount: 0, vat: 15 });
  // An upload: no lines, no VAT → 15% inclusive, "orders without products".
  await order("2026-06-04", "230.00", {}, { feed: false });
  // Closed feed orders BEFORE the range: they feed the delivery rate only.
  for (let i = 0; i < 3; i++) await order("2026-05-20", "100.00", { payment_method: "cod", order_status: "delivered" });
  await order("2026-05-20", "100.00", { payment_method: "cod", order_status: "restored" });
  // Another brand — never seen.
  await order("2026-06-01", "999.00", { payment_method: "cod", order_status: "delivered" }, { accountId: ACCOUNT_B });

  await db.insert(storeOrderItems).values([
    item(o1, 0, "SKU-A", 1, "299.00"),
    item(o2, 0, "SKU-A", 2, "345.00"),
    item(o2, 1, "SKU-B", 1, "207.00"),
    item(o3, 0, "SKU-C", 1, "115.00"),
  ]);
  await db.insert(storeProductCosts).values([
    { accountId: ACCOUNT_A, productKey: "SKU-A", unitCostSar: "57.00", effectiveFrom: "2026-01-01" },
    { accountId: ACCOUNT_A, productKey: "SKU-B", unitCostSar: "30.00", effectiveFrom: "2026-06-02" },
  ]);
});

beforeEach(() => setAccount(ACCOUNT_A));

describe("actualFacts", () => {
  it("splits every order as Salla's identity says, and the lines foot to the product money", async () => {
    const f = await actualFacts(FROM, TO, "2026-04-01");
    const sum = (k: "totalInclVat" | "vat" | "net" | "productNet" | "feesNet" | "netWithoutLines") =>
      f.orders.reduce((s, o) => s + o[k], 0);
    expect(sum("totalInclVat")).toBeCloseTo(294.05 + 575 + 115 + 230, 6);
    expect(sum("net")).toBeCloseTo(sum("totalInclVat") - sum("vat"), 6);
    // o1: product 247, fees 8.70 · o2: product 480, fees 20 · o3: product 100.
    expect(sum("productNet")).toBeCloseTo(247 + 480 + 100, 6);
    expect(sum("feesNet")).toBeCloseTo(8.7 + 20, 6);
    // The upload: 230 incl. 15% VAT → 200 net, all of it without products.
    expect(sum("netWithoutLines")).toBeCloseTo(200, 6);
    expect(sum("net")).toBeCloseTo(sum("productNet") + sum("feesNet") + sum("netWithoutLines"), 6);
    // Lines foot to the product money, order by order.
    expect(f.lines.reduce((s, l) => s + l.revenue, 0)).toBeCloseTo(247 + 480 + 100, 6);
    const o2a = f.lines.find((l) => l.productKey === "SKU-A" && l.quantity === 2)!;
    expect(o2a.revenue).toBeCloseTo((480 * 345) / 552, 6);
  });

  it("reads outcomes from the Store's status stages, and costs on the order's day", async () => {
    const f = await actualFacts(FROM, TO, "2026-04-01");
    const by = (k: string, q: number) => f.lines.find((l) => l.productKey === k && l.quantity === q)!;
    expect(by("SKU-A", 1)).toMatchObject({ outcome: "delivered", paymentMethod: "cod", cogs: 57, uncostedUnits: 0 });
    expect(by("SKU-A", 2)).toMatchObject({ outcome: "open", paymentMethod: "mada", cogs: 114 });
    expect(by("SKU-B", 1)).toMatchObject({ outcome: "open", cogs: 30 });
    expect(by("SKU-C", 1)).toMatchObject({ outcome: "lost", uncostedUnits: 1 });
  });

  it("delivery rates read closed FEED orders of the window only", async () => {
    const f = await actualFacts(FROM, TO, "2026-04-01");
    const cod = f.rates.find((r) => r.paymentMethod === "cod")!;
    // 3 delivered + o1 delivered; 1 restored + o3 cancelled. The upload has no status and isn't a feed order.
    expect(cod).toEqual({ paymentMethod: "cod", delivered: 4, lost: 2 });
    expect(f.rates.find((r) => r.paymentMethod === "mada")).toEqual({ paymentMethod: "mada", delivered: 0, lost: 0 });
  });

  it("ad spend is the raw sum by the creative's product over the range", async () => {
    const f = await actualFacts(FROM, TO, "2026-04-01");
    const [direct] = await db
      .select({ s: sql<string>`COALESCE(SUM(${performanceRecords.spend}), 0)` })
      .from(performanceRecords)
      .where(and(eq(performanceRecords.accountId, ACCOUNT_A), gte(performanceRecords.date, FROM), lte(performanceRecords.date, TO)));
    expect(f.adSpend.reduce((s, a) => s + a.spendUsd, 0)).toBeCloseTo(Number(direct!.s), 4);
  });

  it("never reads another brand", async () => {
    setAccount(ACCOUNT_B);
    const f = await actualFacts(FROM, TO, "2026-04-01");
    expect(f.orders.reduce((s, o) => s + o.orders, 0)).toBe(1);
    expect(f.lines).toEqual([]);
  });
});

describe("mappings", () => {
  it("are per brand, a new product clears the SKU's offers, and the engine foots end to end", async () => {
    const data = sampleVersionData();
    const p = data.products[0]!;
    await db.transaction((tx) => setSkuProduct(tx, ACCOUNT_A, null as unknown as string, "SKU-A", p.id));
    await setSkuOffer(db, ACCOUNT_A, null as unknown as string, "SKU-A", 1, p.offers[0]!.id);
    const [lib] = await db
      .select({ id: products.id })
      .from(products)
      .innerJoin(creatives, eq(creatives.productId, products.id))
      .where(eq(products.accountId, ACCOUNT_A))
      .limit(1);
    if (lib) await setAdProduct(db, ACCOUNT_A, null as unknown as string, lib.id, p.id);

    const m = await actualMappings();
    expect(m.skuProduct["SKU-A"]).toBe(p.id);
    expect(m.skuOffer[skuOfferKey("SKU-A", 1)]).toBe(p.offers[0]!.id);
    setAccount(ACCOUNT_B);
    expect((await actualMappings()).skuProduct).toEqual({});
    setAccount(ACCOUNT_A);

    const f = await actualFacts(FROM, TO, "2026-04-01");
    const r = computeActual(f, m, data, data.plans[0]!);
    // The upload has no products: CML is withheld, but every figure still foots.
    expect(r.complete).toBe(false);
    expect(r.counts.uploaded).toBe(1);
    expect(r.open.map((o) => o.paymentMethod)).toEqual(["mada"]);
    expect(r.storeTotalInclVat - r.vat - r.lostNet - r.openFailNet - r.uploadedFailNet).toBeCloseTo(r.netRevenue, 6);
    const rows =
      r.products.reduce((s, x) => s + x.cml, 0) +
      r.unmapped.reduce((s, u) => s + u.revenue - u.cogs, 0) +
      r.fees +
      r.withoutProductsNet -
      r.adsNotMappedSpend;
    expect(rows).toBeCloseTo(r.cml, 6);

    // Re-pointing the SKU at another product drops its offers (they were the old product's).
    await db.transaction((tx) => setSkuProduct(tx, ACCOUNT_A, null as unknown as string, "SKU-A", data.products[1]!.id));
    const left = await db.select().from(psSkuOfferMappings).where(eq(psSkuOfferMappings.productKey, "SKU-A"));
    expect(left).toEqual([]);
  });
});
