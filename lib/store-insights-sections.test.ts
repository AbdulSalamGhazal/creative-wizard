import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_EXCLUDED_KEYS,
  OTHER_VALUE,
  avgDeliveryDays,
  foldSection,
  grossProfit,
  insightDimensions,
  isGroupable,
  rate,
  type LensSums,
  type LensValue,
} from "@/lib/store-insights";
import { CONNECTOR_CUSTOMER_KEYS } from "@/lib/connector/map-order";
import { FEED_FIELDS } from "@/store/feed-fields";
import type { StoreField } from "@/store/fields";
import { paymentMethodLabel } from "@/store/payment-methods";

const field = (key: string, type: StoreField["type"] = "text"): StoreField =>
  ({ key, label: key, type, core: false, systemRequired: false }) as StoreField;

describe("the breakdown list leaves out what isn't a breakdown", () => {
  it("excludes every personal key the feed fills", () => {
    for (const k of Object.values(CONNECTOR_CUSTOMER_KEYS)) {
      expect(BREAKDOWN_EXCLUDED_KEYS).toContain(k);
    }
  });

  it("offers text fields only, never numbers, dates or the excluded keys", () => {
    expect(isGroupable(field("city"))).toBe(true);
    expect(isGroupable(field("discount", "number"))).toBe(false);
    expect(isGroupable(field("delivered_date", "date"))).toBe(false);
    expect(isGroupable(field("phone"))).toBe(false);
    expect(isGroupable(field("tracking_number"))).toBe(false);
    const keys = insightDimensions([field("phone"), field("city"), field("vat", "number")]).map(
      (d) => d.key,
    );
    expect(keys).toContain("city");
    expect(keys).not.toContain("phone");
    expect(keys).not.toContain("vat");
  });

  it("names only keys that exist (a feed field or a customer key)", () => {
    const known = new Set<string>([
      ...FEED_FIELDS.map((f) => f.key),
      ...Object.values(CONNECTOR_CUSTOMER_KEYS),
    ]);
    for (const k of BREAKDOWN_EXCLUDED_KEYS) expect(known.has(k)).toBe(true);
  });
});

const v = (value: string | null, orders: number, revenue = orders * 100): LensValue => ({
  value,
  orders,
  revenue,
  lost: 0,
  couponDiscount: 0,
  offerDiscount: 0,
  delivered: 0,
  deliveryDays: 0,
});
const sums = (rows: LensValue[]): LensSums => ({
  orders: rows.reduce((a, r) => a + r.orders, 0),
  revenue: rows.reduce((a, r) => a + r.revenue, 0),
  lost: 0,
  couponDiscount: 0,
  offerDiscount: 0,
  delivered: 0,
  deliveryDays: 0,
});

describe("foldSection", () => {
  it("keeps the top N, shows the blank bucket, and folds the rest", () => {
    const rows = [v("a", 10), v("b", 8), v("c", 3), v("d", 1), v(null, 2)];
    const out = foldSection(rows, sums(rows), 2);
    expect(out.map((r) => r.value)).toEqual(["a", "b", null, OTHER_VALUE]);
    expect(out.at(-1)!.orders).toBe(4);
    expect(out.at(-1)!.foldedCount).toBe(2);
    expect(out.reduce((a, r) => a + r.orders, 0)).toBe(24);
  });

  it("folds orders the capped query never returned", () => {
    const rows = [v("a", 10)];
    const out = foldSection(rows, { ...sums(rows), orders: 15, revenue: 1500 }, 5);
    expect(out.at(-1)).toMatchObject({ value: OTHER_VALUE, orders: 5, revenue: 500 });
  });

  it("adds no Other row when everything fits", () => {
    const rows = [v("a", 1), v("b", 1)];
    expect(foldSection(rows, sums(rows)).map((r) => r.value)).toEqual(["a", "b"]);
  });
});

describe("rates", () => {
  it("are null with nothing to divide by", () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
    expect(avgDeliveryDays({ delivered: 0, deliveryDays: 0 })).toBeNull();
    expect(avgDeliveryDays({ delivered: 2, deliveryDays: 5 })).toBe(2.5);
  });

  it("gross profit is null without a costed line", () => {
    expect(grossProfit({ costedSalesExVat: 0, cogs: 0 })).toEqual({ profit: null, margin: null });
    const g = grossProfit({ costedSalesExVat: 200, cogs: 50 });
    expect(g.profit).toBe(150);
    expect(g.margin).toBe(0.75);
  });
});

describe("paymentMethodLabel", () => {
  it("names the known slugs and humanizes the rest", () => {
    expect(paymentMethodLabel("cod")).toBe("Cash on delivery");
    expect(paymentMethodLabel("tabby_installment")).toBe("Tabby");
    expect(paymentMethodLabel("new_wallet")).toBe("New wallet");
  });
});
