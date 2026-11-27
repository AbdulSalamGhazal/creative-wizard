import { describe, expect, it } from "vitest";
import { sampleVersionData } from "../engine/sample";
import { evaluateOffer } from "../engine/evaluate";
import { computeActual, daysInRange, MIN_CLOSED_FOR_RATE, resolveRates } from "./engine";
import { skuOfferKey, type ActualFacts, type ActualMappings, type LineFact, type OrderFact } from "./facts";

const data = sampleVersionData();
const ultra = data.products[0]!;
const single = ultra.offers[0]!;
const plan = data.plans.find((p) => p.id === data.activePlanId)!;

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

function line(p: Partial<LineFact>): LineFact {
  return {
    productKey: "S005-Black",
    name: "Ultra 3",
    quantity: 1,
    outcome: "delivered",
    paymentMethod: "mada",
    lines: 10,
    units: 10,
    revenue: 2500,
    cogs: 900,
    uncostedUnits: 0,
    ...p,
  };
}
function order(p: Partial<OrderFact>): OrderFact {
  return {
    outcome: "delivered",
    paymentMethod: "mada",
    orders: 10,
    totalInclVat: 3000,
    vat: 391.3,
    net: 2608.7,
    productNet: 2500,
    feesNet: 108.7,
    ordersWithoutLines: 0,
    netWithoutLines: 0,
    ...p,
  };
}

/** Ten delivered, four open COD, six lost — one SKU, one Library product. */
function facts(over: Partial<ActualFacts> = {}): ActualFacts {
  return {
    from: "2026-11-01",
    to: "2026-11-10",
    lines: [
      line({}),
      line({ outcome: "open", paymentMethod: "cod", lines: 4, units: 4, revenue: 1000, cogs: 360 }),
      line({ outcome: "lost", paymentMethod: "cod", lines: 6, units: 6, revenue: 1500, cogs: 540 }),
    ],
    orders: [
      order({}),
      order({ outcome: "open", paymentMethod: "cod", orders: 4, totalInclVat: 1200, vat: 156.52, net: 1043.48, productNet: 1000, feesNet: 43.48 }),
      order({ outcome: "lost", paymentMethod: "cod", orders: 6, totalInclVat: 1800, vat: 234.78, net: 1565.22, productNet: 1500, feesNet: 65.22 }),
    ],
    rates: [
      { paymentMethod: "cod", delivered: 30, lost: 20 },
      { paymentMethod: "mada", delivered: 99, lost: 1 },
    ],
    ratesFrom: "2026-08-12",
    ratesTo: "2026-11-10",
    adSpend: [{ productId: "lib-ultra", productName: "Ultra", spendUsd: 200 }],
    ...over,
  };
}
const mapped: ActualMappings = {
  skuProduct: { "S005-Black": ultra.id },
  skuOffer: { [skuOfferKey("S005-Black", 1)]: single.id },
  adProduct: { "lib-ultra": ultra.id },
};

describe("actual CML — real money", () => {
  const r = computeActual(facts(), mapped, data, plan);

  it("counts lost orders for nothing and open orders at their payment method's rate", () => {
    // COD: 30 delivered of 50 closed = 60%.
    close(r.openExpectedNet, 1043.48 * 0.6);
    close(r.netRevenue, 2608.7 + 1043.48 * 0.6);
    close(r.cogs, 900 + 360 * 0.6);
    expect(r.counts).toEqual({ delivered: 10, open: 4, lost: 6, uploaded: 0, all: 20 });
  });

  it("CML = net revenue − COGS − ad spend, ad spend at the version's rate", () => {
    close(r.adSpend, 200 * data.settings.usdToSar);
    close(r.cml, r.netRevenue - r.cogs - r.adSpend);
    close(r.settledCml + r.expectedCml, r.cml);
    close(r.settledCml, 2608.7 - 900 - r.adSpend);
  });

  it("the waterfall foots: store total − VAT − lost − open expected to fail = net revenue", () => {
    close(r.storeTotalInclVat - r.vat - r.lostNet - r.openFailNet, r.netRevenue, 1e-6);
  });

  it("the rows foot to CML: products + unmapped + fees + orders without products − unmapped ads", () => {
    const unmapped = facts({
      lines: [...facts().lines, line({ productKey: "G999", lines: 2, units: 2, revenue: 300, cogs: 100 })],
      orders: [...facts().orders, order({ orders: 2, totalInclVat: 345, vat: 45, net: 300, productNet: 300, feesNet: 0 })],
      adSpend: [...facts().adSpend, { productId: "lib-other", productName: "Other", spendUsd: 10 }],
    });
    const x = computeActual(unmapped, mapped, data, plan);
    const rows =
      x.products.reduce((s, p) => s + p.cml, 0) +
      x.unmapped.reduce((s, u) => s + u.revenue - u.cogs, 0) +
      x.fees +
      x.withoutProductsNet -
      x.adsNotMappedSpend;
    close(rows, x.cml);
    expect(x.unmapped.map((u) => u.productKey)).toEqual(["G999"]);
    expect(x.adsNotMapped.map((a) => a.productName)).toEqual(["Other"]);
  });

  it("puts a quantity with no offer under the product's 'No offer' row", () => {
    const x = computeActual(facts({ lines: [line({}), line({ quantity: 2, lines: 1, units: 2, revenue: 400, cogs: 180 })] }), mapped, data, plan);
    const offers = x.products[0]!.offers;
    expect(offers.map((o) => o.offerId)).toEqual([single.id, null]);
    expect(offers[1]!.name).toBe("No offer");
  });

  it("a SKU mapped to a product this version lacks reads 'not in this version'", () => {
    const x = computeActual(facts(), { ...mapped, skuProduct: { "S005-Black": "gone" } }, data, plan);
    expect(x.products.find((p) => p.productId === ultra.id)?.offers ?? []).toEqual([]);
    expect(x.unmapped[0]!.notInVersion).toBe(true);
  });

  it("withholds CML while a delivered or open unit has no cost — a lost one doesn't matter", () => {
    const lostOnly = computeActual(
      facts({ lines: [line({}), line({ outcome: "lost", paymentMethod: "cod", uncostedUnits: 3, cogs: 0 })] }),
      mapped,
      data,
      plan,
    );
    expect(lostOnly.complete).toBe(true);
    const open = computeActual(facts({ lines: [line({ uncostedUnits: 2 })] }), mapped, data, plan);
    expect(open.complete).toBe(false);
    expect(open.uncostedSkus).toEqual(["S005-Black"]);
    expect(open.bridge).toBeNull();
    expect(open.bridgeUnavailable).toBe("incomplete");
  });

  it("an uploaded order (no status) counts at the brand's rate, apart from the open orders", () => {
    const x = computeActual(
      facts({ orders: [...facts().orders, order({ outcome: "uploaded", paymentMethod: "not reported", orders: 5, net: 1000, totalInclVat: 1150, vat: 150, productNet: 0, feesNet: 0, ordersWithoutLines: 5, netWithoutLines: 1000 })] }),
      mapped,
      data,
      plan,
    );
    // Brand: (30 + 99) delivered of 150 closed.
    close(x.uploadedExpectedNet, 1000 * (129 / 150));
    expect(x.counts.uploaded).toBe(5);
    expect(x.open.map((o) => o.paymentMethod)).toEqual(["cod"]);
    close(x.storeTotalInclVat - x.vat - x.lostNet - x.openFailNet - x.uploadedFailNet, x.netRevenue);
    expect(x.complete).toBe(false);
  });

  it("an order with no products leaves CML incomplete", () => {
    const x = computeActual(facts({ orders: [...facts().orders, order({ orders: 1, ordersWithoutLines: 1, netWithoutLines: 100, productNet: 0, feesNet: 0, net: 100, totalInclVat: 115, vat: 15 })] }), mapped, data, plan);
    expect(x.complete).toBe(false);
    expect(x.ordersWithoutProducts).toBe(1);
  });
});

describe("plan → actual bridge", () => {
  it("adds up to the gap exactly", () => {
    const r = computeActual(facts(), mapped, data, plan);
    expect(r.bridge).not.toBeNull();
    const steps = r.bridge!;
    const sum = steps.filter((s) => s.key !== "plan" && s.key !== "actual").reduce((s, x) => s + x.value, steps[0]!.value);
    close(sum, r.cml, 1e-6);
    expect(steps.at(-1)).toEqual({ key: "actual", value: r.cml });
  });

  it("an actual that IS the plan has zero steps", () => {
    // One offer only, delivered at exactly the plan's per-order economics.
    const onePlan = { ...plan, ordersPerDay: 2, productShare: { [ultra.id]: 1 }, offerShare: { [single.id]: 1 } };
    const e = evaluateOffer(ultra, single, data.settings);
    const days = 10;
    const placed = 2 * days; // 20 placed; the sample's 85% delivers 17, loses 3
    const delivered = placed * e.deliveryRate;
    const lost = placed - delivered;
    expect(delivered).toBe(17);
    const x = computeActual(
      {
        from: "2026-11-01",
        to: "2026-11-10",
        lines: [
          line({ lines: delivered, units: delivered, revenue: delivered * e.netRevenue, cogs: delivered * e.cogs }),
          line({ outcome: "lost", lines: lost, units: lost, revenue: lost * e.netRevenue, cogs: lost * e.cogs }),
        ],
        orders: [
          order({ orders: delivered, net: delivered * e.netRevenue, productNet: delivered * e.netRevenue, feesNet: 0 }),
          order({ outcome: "lost", orders: lost, net: lost * e.netRevenue, productNet: lost * e.netRevenue, feesNet: 0 }),
        ],
        rates: [],
        ratesFrom: "2026-08-12",
        ratesTo: "2026-11-10",
        adSpend: [{ productId: "lib-ultra", productName: "Ultra", spendUsd: (placed * e.adSpend) / data.settings.usdToSar }],
      },
      mapped,
      data,
      onePlan,
    );
    const by = Object.fromEntries(x.bridge!.map((s) => [s.key, s.value]));
    close(by.volume!, 0, 1e-6);
    close(by.mix!, 0, 1e-6);
    close(by.price!, 0, 1e-6);
    close(by.cogs!, 0, 1e-6);
    close(by.ads!, 0, 1e-6);
    close(by.notInPlan!, 0, 1e-6);
  });

  it("is unavailable without a plan", () => {
    expect(computeActual(facts(), mapped, data, null).bridgeUnavailable).toBe("no-plan");
  });
});

describe("delivery rates", () => {
  it("falls back from method to brand to the version setting", () => {
    const few = MIN_CLOSED_FOR_RATE - 1;
    const { rateOf } = resolveRates(
      [
        { paymentMethod: "cod", delivered: 40, lost: 10 },
        { paymentMethod: "stc_pay", delivered: few, lost: 0 },
      ],
      0.85,
    );
    expect(rateOf("cod")).toMatchObject({ rate: 0.8, source: "method" });
    expect(rateOf("stc_pay").source).toBe("brand");
    expect(resolveRates([], 0.85).rateOf("cod")).toMatchObject({ rate: 0.85, source: "version" });
  });
  it("counts days inclusively", () => {
    expect(daysInRange("2026-11-01", "2026-11-26")).toBe(26);
    expect(daysInRange("2026-11-01", "2026-11-01")).toBe(1);
  });
});
