import { describe, expect, it } from "vitest";
import { signConnectorBody, verifyConnectorSignature } from "@/lib/connector/verify";
import {
  CONNECTOR_CUSTOMER_KEYS,
  CONNECTOR_OWNED_KEYS,
  mapConnectorOrder,
} from "@/lib/connector/map-order";
import { pulledOrderEvent } from "@/lib/connector/ingest";
import { riyadhToday } from "@/lib/connector/time";
import { orderStatusLabel, orderStatusTone } from "@/store/order-status";
import { FEED_FIELDS, FEED_FIELD_KEYS, FEED_FIELDS_HIDDEN_BY_DEFAULT } from "@/store/feed-fields";
import { readFileSync } from "node:fs";
import path from "node:path";

const SECRET = "whsec_test_secret";
const NOW = 1_800_000_000_000;
const TS = String(NOW / 1000);
const BODY = JSON.stringify({ events: [{ id: "e1" }] });

describe("connector webhook signature", () => {
  const good = signConnectorBody(BODY, TS, SECRET);
  const check = (over: Partial<Parameters<typeof verifyConnectorSignature>[0]> = {}) =>
    verifyConnectorSignature({
      rawBody: BODY, timestamp: TS, signature: good, secret: SECRET, nowMs: NOW, ...over,
    });

  it("accepts the connector's own signature", () => {
    expect(check()).toBe(true);
    // Upper-case hex is the same signature.
    expect(check({ signature: "sha256=" + good.slice(7).toUpperCase() })).toBe(true);
  });

  it("refuses a tampered body, a wrong secret and a missing header", () => {
    expect(check({ rawBody: BODY + " " })).toBe(false);
    expect(check({ secret: "other" })).toBe(false);
    expect(check({ signature: null })).toBe(false);
    expect(check({ timestamp: null })).toBe(false);
    expect(check({ signature: good.slice(7) })).toBe(false); // no sha256= prefix
    expect(check({ signature: "sha256=zz" })).toBe(false);
  });

  it("refuses a timestamp more than five minutes off, either way", () => {
    expect(check({ nowMs: NOW + 299_000 })).toBe(true);
    expect(check({ nowMs: NOW + 301_000 })).toBe(false);
    expect(check({ nowMs: NOW - 301_000 })).toBe(false);
    // A signature over a different timestamp doesn't travel.
    expect(check({ timestamp: String(NOW / 1000 + 1) })).toBe(false);
    expect(check({ timestamp: "soon" })).toBe(false);
  });
});

const order = (over: Record<string, unknown> = {}) => ({
  reference: "298890143",
  store: "urjwan",
  created_at: "2026-11-08T20:56:10+03:00",
  updated_at: "2026-11-08T21:10:00+03:00",
  status: { slug: "delivered", label: "تم التوصيل" },
  amounts: { subtotal_excl_vat: 300, total: 412 },
  attribution: { utm_source: "tiktok", utm_medium: "paid", device: "mobile-app" },
  items: [{ sku: "A", quantity: 1 }],
  ...over,
});

describe("mapConnectorOrder", () => {
  it("maps reference, the Riyadh day, the total and the three feed-owned fields", () => {
    expect(mapConnectorOrder(order())).toEqual({
      orderId: "298890143",
      orderDate: "2026-11-08",
      orderedAt: "2026-11-08T17:56:10.000Z",
      totalAmount: "412.00",
      attributes: {
        utm_source: "tiktok",
        channel: "mobile-app",
        order_status: "delivered",
        subtotal: 300,
        utm_medium: "paid",
      },
      updatedAt: "2026-11-08T18:10:00.000Z",
      items: [{ position: 0, sku: "A", name: null, quantity: 1, lineTotalSar: null, unitPriceSar: null, originalUnitPriceSar: null }],
    });
    expect(CONNECTOR_OWNED_KEYS.slice(0, 3)).toEqual(["utm_source", "channel", "order_status"]);
    expect(CONNECTOR_OWNED_KEYS.slice(3)).toEqual([...FEED_FIELD_KEYS]);
  });

  it("files a 23:30 Riyadh order under its RIYADH day, not the UTC one", () => {
    const m = mapConnectorOrder(order({ created_at: "2026-11-08T23:30:00+03:00" }));
    expect(m?.orderDate).toBe("2026-11-08");
    // 02:00 Riyadh is still the previous day in UTC — the Riyadh day wins.
    expect(mapConnectorOrder(order({ created_at: "2026-11-09T02:00:00+03:00" }))?.orderDate).toBe(
      "2026-11-09",
    );
  });

  it("keeps the instant it was placed: Riyadh wall time, with or without +03:00; a bare date has none", () => {
    const at = (created_at: string) => mapConnectorOrder(order({ created_at }))?.orderedAt;
    expect(at("2026-11-08T23:30:00+03:00")).toBe("2026-11-08T20:30:00.000Z");
    expect(at("2026-11-08 23:30:00")).toBe("2026-11-08T20:30:00.000Z");
    expect(at("2026-11-08 23:30 +0300")).toBe("2026-11-08T20:30:00.000Z");
    expect(at("2026-11-08")).toBeNull();
  });

  it("an order with no UTM, device or status simply has no such keys", () => {
    const m = mapConnectorOrder(
      order({ attribution: null, status: null, amounts: { total: 412 } }),
    );
    expect(m?.attributes).toEqual({});
    const blank = mapConnectorOrder(
      order({ attribution: { utm_source: "  ", device: null }, amounts: { total: 412 } }),
    );
    expect(blank?.attributes).toEqual({ order_status: "delivered" });
  });

  it("tolerates a numeric reference and a numeric-string total", () => {
    const m = mapConnectorOrder(order({ reference: 298890143, amounts: { total: "99.5" } }));
    expect(m).toMatchObject({ orderId: "298890143", totalAmount: "99.50" });
  });

  it("files the SAR total, so a foreign-currency order is never stored as riyals", () => {
    const qar = order({ currency: "QAR", amounts: { total: 305.88, total_sar: 314.05 } });
    expect(mapConnectorOrder(qar)?.totalAmount).toBe("314.05");
    // Foreign currency and no SAR total: not applied (the raw event is still kept).
    expect(mapConnectorOrder(order({ currency: "QAR", amounts: { total: 305.88 } }))).toBeNull();
    // A SAR order, or a payload from before the connector sent a currency, uses `total`.
    expect(mapConnectorOrder(order({ currency: "SAR", amounts: { total: 412 } }))?.totalAmount).toBe(
      "412.00",
    );
    expect(mapConnectorOrder(order({ currency: null }))?.totalAmount).toBe("412.00");
  });

  it("fills the customer's name, phone (+digits, like the export) and email when sent", () => {
    const m = mapConnectorOrder(
      order({ customer: { salla_id: 1, name: " Sara ", phone: "966500000000", email: "s@x.sa" } }),
    );
    expect(m?.attributes).toMatchObject({
      customer_name: "Sara",
      phone: "+966500000000",
      email: "s@x.sa",
    });
    // Personal data not opened: the keys are absent, and nothing is written.
    const none = mapConnectorOrder(order({ customer: { salla_id: 1 } }));
    expect(Object.keys(none!.attributes)).not.toContain("customer_name");
    expect(Object.keys(none!.attributes)).not.toContain("phone");
    // Customer keys are filled, never owned: an absent name never erases an uploaded one.
    expect([...CONNECTOR_OWNED_KEYS]).not.toContain(CONNECTOR_CUSTOMER_KEYS.name);
  });

  it("maps each product line: SAR incl. VAT, quantity rounded, a bad line skipped", () => {
    const watch = { sku: " S005-Silver ", name: "ساعة", quantity: 1, unit_price: 260, total: 299 };
    const m = mapConnectorOrder(
      order({ items: [watch, null, { sku: "B", quantity: "2.6", total: "10" }, { sku: "C", total: 5 }] }),
    );
    expect(m?.items).toEqual([
      { position: 0, sku: "S005-Silver", name: "ساعة", quantity: 1, lineTotalSar: "299.00", unitPriceSar: "260.00", originalUnitPriceSar: null },
      { position: 2, sku: "B", name: null, quantity: 3, lineTotalSar: "10.00", unitPriceSar: null, originalUnitPriceSar: null },
    ]);
    // Sale prices: per unit excl. VAT, converted to SAR like the total.
    expect(
      mapConnectorOrder(
        order({ currency: "QAR", exchange_rate: 2, amounts: { total: 100, total_sar: 200, sale_discount: 15 }, items: [{ ...watch, unit_price: 50, original_price: 65 }] }),
      ),
    ).toMatchObject({
      items: [{ unitPriceSar: "100.00", originalUnitPriceSar: "130.00" }],
      attributes: { sale_discount: 30 },
    });
    // Nothing on sale (the connector sends 0): no Sale discount written.
    expect(mapConnectorOrder(order({ amounts: { total: 100, sale_discount: 0 } }))?.attributes).not.toHaveProperty(
      "sale_discount",
    );
    // A foreign order converts with its rate; without a rate the SAR figure is unknown, never guessed.
    const qar = { currency: "QAR", amounts: { total: 100, total_sar: 102.67 } };
    expect(
      mapConnectorOrder(order({ ...qar, exchange_rate: 1.0267, items: [{ ...watch, total: 100 }] }))?.items[0]
        ?.lineTotalSar,
    ).toBe("102.67");
    expect(mapConnectorOrder(order({ ...qar, items: [watch] }))?.items[0]?.lineTotalSar).toBeNull();
    expect(mapConnectorOrder(order({ items: "nope" }))?.items).toEqual([]);
  });

  it("fills every Salla field: money in SAR as numbers, lists joined, the delivered day", () => {
    const m = mapConnectorOrder(
      order({
        currency: "QAR",
        exchange_rate: 2,
        payment_method: "prepaid",
        payment_method_raw: "tabby_installment",
        source: "lp-123",
        amounts: { total: 100, total_sar: 200, subtotal_excl_vat: 80, discount: 5, shipping: 10, cod_fee: 0, tax: 12 },
        coupons: [{ code: "SALE10", discount: 3 }, { code: " ", discount: 1 }, "junk"],
        shipping: { city: "Riyadh", country: "SA", company: "SMSA", tracking_number: "T1", delivered_at: "2026-11-10T23:30:00+03:00" },
        refund: { amount: 7.5, items: [] },
        tags: ["VIP", "", 3],
        customer: { salla_id: 42 },
        attribution: { utm_source: "tiktok", utm_medium: "paid", utm_campaign: "c1", entry: "direct", device: "mobile" },
      }),
    );
    expect(m?.attributes).toMatchObject({
      payment_method: "tabby_installment",
      payment_type: "Prepaid",
      salla_source: "lp-123",
      subtotal: 160,
      discount: 10,
      shipping_fee: 20,
      cod_fee: 0,
      vat: 24,
      coupon_code: "SALE10",
      coupon_discount: 8,
      city: "Riyadh",
      country: "SA",
      shipping_company: "SMSA",
      tracking_number: "T1",
      delivered_date: "2026-11-10",
      refund_amount: 15,
      tags: "VIP",
      utm_medium: "paid",
      utm_campaign: "c1",
      entry: "direct",
      currency: "QAR",
      exchange_rate: 2,
      salla_customer_id: "42",
    });
    // A foreign order with no rate keeps its text fields but no money.
    const noRate = mapConnectorOrder(
      order({ currency: "AED", amounts: { total: 1, total_sar: 1, discount: 5 }, shipping: { city: "Dubai" } }),
    );
    expect(noRate?.attributes).toMatchObject({ city: "Dubai", currency: "AED" });
    expect(noRate?.attributes).not.toHaveProperty("discount");
  });

  it("fills Salla special offers apart from coupons; no offer = no value", () => {
    const withOffer = mapConnectorOrder(
      order({
        currency: "QAR",
        exchange_rate: 2,
        amounts: { total: 100, total_sar: 200, discount: 9, offers_discount: 6 },
        coupons: [{ code: "SALE10", discount: 3 }],
        offers: [{ name: "ساعتين + الثالثة مجانا!", discount: 4 }, { name: "Bundle", discount: 2 }, "junk"],
      }),
    );
    expect(withOffer?.attributes).toMatchObject({
      coupon_code: "SALE10",
      coupon_discount: 6,
      offers: "ساعتين + الثالثة مجانا!, Bundle",
      offers_discount: 12,
      discount: 18,
    });
    // No order total sent: the offers' own discounts add up.
    expect(
      mapConnectorOrder(order({ offers: [{ name: "A", discount: 4 }, { name: "B", discount: 1.5 }] }))?.attributes,
    ).toMatchObject({ offers: "A, B", offers_discount: 5.5 });
    // The connector sends 0 when there is no offer: nothing is written.
    const none = mapConnectorOrder(order({ amounts: { total: 100, offers_discount: 0 }, offers: [] }));
    expect(none?.attributes).not.toHaveProperty("offers");
    expect(none?.attributes).not.toHaveProperty("offers_discount");
  });

  it("migrations 0078 + 0080 + 0082 seed exactly the feed field list, and only four start shown", () => {
    const sqlText = ["0078_store_feed_fields.sql", "0080_store_offer_fields.sql", "0082_store_sale_discount_field.sql"]
      .map((f) => readFileSync(path.join(process.cwd(), "db/migrations", f), "utf8"))
      .join("\n");
    const seeded = [...sqlText.matchAll(/\('([a-z_]+)', '([^']+)', '([a-z]+)', \d+\)/g)].map((m) => ({
      key: m[1],
      label: m[2],
      type: m[3],
    }));
    expect(seeded).toEqual(FEED_FIELDS.map(({ key, label, type }) => ({ key, label, type })));
    expect(FEED_FIELDS.filter((f) => f.shown).map((f) => f.key)).toEqual([
      "payment_method",
      "coupon_code",
      "discount",
      "city",
    ]);
    expect(FEED_FIELDS_HIDDEN_BY_DEFAULT).toHaveLength(FEED_FIELDS.length - 4);
  });

  it("returns null for what can't be a Store row — never a guess", () => {
    expect(mapConnectorOrder(order({ reference: null }))).toBeNull();
    expect(mapConnectorOrder(order({ reference: "x".repeat(65) }))).toBeNull();
    expect(mapConnectorOrder(order({ created_at: "2026-11-08T20:56:10Z" }))).toBeNull();
    expect(mapConnectorOrder(order({ created_at: null }))).toBeNull();
    expect(mapConnectorOrder(order({ amounts: { total: null } }))).toBeNull();
    expect(mapConnectorOrder(order({ amounts: null }))).toBeNull();
    expect(mapConnectorOrder(order({ amounts: { total: "abc" } }))).toBeNull();
    expect(mapConnectorOrder(null)).toBeNull();
    expect(mapConnectorOrder("order")).toBeNull();
  });
});

describe("helpers", () => {
  it("a pulled order's event id is its own version, so a re-pull is a no-op", () => {
    const e = pulledOrderEvent("urjwan", order()) as { id: string; type: string };
    expect(e.id).toBe("pull:urjwan:298890143:2026-11-08T21:10:00+03:00");
    expect(e.type).toBe("order.snapshot");
  });

  it("riyadhToday rolls over at 21:00 UTC", () => {
    expect(riyadhToday(Date.parse("2026-11-08T20:59:00Z"))).toBe("2026-11-08");
    expect(riyadhToday(Date.parse("2026-11-08T21:00:00Z"))).toBe("2026-11-09");
  });

  it("every status is coloured by stage: waiting grey, on the way blue, delivered green, refunded amber, cancelled red", () => {
    expect(orderStatusTone("cancelled")).toBe("neg");
    expect(orderStatusTone("canceled")).toBe("neg");
    expect(orderStatusTone("deleted")).toBe("neg");
    expect(orderStatusTone("refunded")).toBe("warn");
    expect(orderStatusTone("restored")).toBe("warn");
    expect(orderStatusTone("restoring")).toBe("warn");
    expect(orderStatusTone("delivered")).toBe("pos");
    expect(orderStatusTone("shipped")).toBe("info");
    expect(orderStatusTone("delivering")).toBe("info");
    for (const s of ["payment_pending", "under_review", "in_progress", "completed", "on_hold"]) {
      expect(orderStatusTone(s)).toBe("neutral");
    }
    expect(orderStatusLabel("payment_pending")).toBe("Payment pending");
    // The connector's documented slugs read as their meaning…
    expect(orderStatusLabel("canceled")).toBe("Cancelled");
    expect(orderStatusLabel("restored")).toBe("Refunded");
    expect(orderStatusLabel("completed")).toBe("Ready to ship");
    // …and one Salla adds later is still shown, humanized.
    expect(orderStatusLabel("on_hold")).toBe("On hold");
  });
});
