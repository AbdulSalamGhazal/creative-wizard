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
      totalAmount: "412.00",
      attributes: { utm_source: "tiktok", channel: "mobile-app", order_status: "delivered" },
      updatedAt: "2026-11-08T18:10:00.000Z",
    });
    expect([...CONNECTOR_OWNED_KEYS]).toEqual(["utm_source", "channel", "order_status"]);
  });

  it("files a 23:30 Riyadh order under its RIYADH day, not the UTC one", () => {
    const m = mapConnectorOrder(order({ created_at: "2026-11-08T23:30:00+03:00" }));
    expect(m?.orderDate).toBe("2026-11-08");
    // 02:00 Riyadh is still the previous day in UTC — the Riyadh day wins.
    expect(mapConnectorOrder(order({ created_at: "2026-11-09T02:00:00+03:00" }))?.orderDate).toBe(
      "2026-11-09",
    );
  });

  it("an order with no UTM, device or status simply has no such keys", () => {
    const m = mapConnectorOrder(order({ attribution: null, status: null }));
    expect(m?.attributes).toEqual({});
    const blank = mapConnectorOrder(order({ attribution: { utm_source: "  ", device: null } }));
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

  it("only cancelled and refunded statuses carry a tone", () => {
    expect(orderStatusTone("cancelled")).toBe("neg");
    expect(orderStatusTone("canceled")).toBe("neg");
    expect(orderStatusTone("refunded")).toBe("warn");
    expect(orderStatusTone("restored")).toBe("warn");
    expect(orderStatusTone("delivered")).toBeNull();
    expect(orderStatusTone("restoring")).toBe("warn");
    expect(orderStatusTone("deleted")).toBe("neg");
    expect(orderStatusLabel("payment_pending")).toBe("Payment pending");
    // The connector's documented slugs read as their meaning…
    expect(orderStatusLabel("canceled")).toBe("Cancelled");
    expect(orderStatusLabel("restored")).toBe("Refunded");
    expect(orderStatusLabel("completed")).toBe("Ready to ship");
    // …and one Salla adds later is still shown, humanized.
    expect(orderStatusLabel("on_hold")).toBe("On hold");
  });
});
