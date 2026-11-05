import { describe, expect, it } from "vitest";
import { actualBlends, blend, planLines, roasFor } from "./blend";
import { evaluateOffer } from "./evaluate";
import { goalSeek } from "./goal-seek";
import { overallStatus, statusAgainst } from "./metrics";
import { evenPlan, sampleVersionData } from "./sample";
import { roasNeeded } from "./targets";
import { orderKey, type ActualPeriod, type Offer, type Plan, type Product } from "./types";

/**
 * Brief §11 — the acceptance numbers from the standalone tool. Tolerance
 * ±0.01 on displayed values, ±0.0001 on fractions.
 */
const data = sampleVersionData();
const S = data.settings;
const product = (name: string): Product => {
  const p = data.products.find((x) => x.name === name);
  if (!p) throw new Error(name);
  return p;
};
const offer = (p: Product, name: string): Offer => {
  const o = p.offers.find((x) => x.name === name);
  if (!o) throw new Error(name);
  return o;
};
const ultra = product("Urjwan Watch Ultra 3");
const earbuds = product("Urjwan Earbuds (Pro 3 / 4)");
const close = (actual: number, expected: number, tol = 0.01) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
const closePct = (actual: number, expectedPct: number) => close(actual, expectedPct / 100, 0.0001);

describe("§11.1 single offers on Ultra 3 (cost 90, price 350)", () => {
  const cases = [
    {
      name: "15% off",
      units: 1, list: 350, pays: 297.5, discount: 15.0, vat: 38.8, net: 258.7, cogs: 90,
      adSpend: 82.875, marketing: 97.5, cml: 71.2, cmlPct: 27.52, cmlUnit: 71.2, cogsPct: 34.79,
      mktPct: 37.69, platform: 3.59, acct: 2.65, adCost: 37.69,
      roasAB: [3.36, 4.48], cpaAB: [23.58, 17.71], roasOrder: [3.22, 7.19], roasUnit50: 2.95,
    },
    {
      name: "Buy 2 get 1 free",
      units: 3, list: 1050, pays: 700, discount: 33.3, vat: 91.3, net: 608.7, cogs: 270,
      adSpend: 116.1, marketing: 136.59, cml: 202.11, cmlPct: 33.2, cmlUnit: 67.37, cogsPct: 44.36,
      mktPct: 22.44, platform: 6.03, acct: 4.46, adCost: 22.44,
      roasAB: [4.42, 6.55], cpaAB: [42.28, 28.48], roasOrder: [2.95, 3.77], roasUnit50: 4.36,
    },
    {
      name: "Buy 1 get 1 at 50% off",
      units: 2, list: 700, pays: 525, discount: 25.0, vat: 68.48, net: 456.52, cogs: 180,
      adSpend: 99.49, marketing: 117.04, cml: 159.48, cmlPct: 34.93, cmlUnit: 79.74, cogsPct: 39.43,
      mktPct: 25.64, platform: 5.28, acct: 3.9, adCost: 25.64,
      roasAB: [3.8, 5.29], cpaAB: [36.81, 26.46], roasOrder: [2.85, 3.95], roasUnit50: 3.5,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = evaluateOffer(ultra, offer(ultra, c.name), S);
      expect(r.units).toBe(c.units);
      close(r.listPrice, c.list);
      close(r.paidGross, c.pays);
      close(r.discount, c.discount / 100, 0.0005);
      close(r.vat, c.vat);
      close(r.netRevenue, c.net);
      close(r.cogs, c.cogs);
      close(r.adSpend, c.adSpend);
      close(r.marketing, c.marketing);
      close(r.profit, c.cml);
      closePct(r.margin, c.cmlPct);
      close(r.profitPerUnit, c.cmlUnit);
      closePct(r.cogsPct, c.cogsPct);
      closePct(r.marketingPct, c.mktPct);
      close(r.platformRoas, c.platform);
      close(r.accountantRoas, c.acct);
      closePct(r.adCostPct, c.adCost);
      close(roasNeeded(r, "margin", 0.25, S.usdToSar).roas, c.roasAB[0]!);
      close(roasNeeded(r, "margin", 0.35, S.usdToSar).roas, c.roasAB[1]!);
      close(roasNeeded(r, "margin", 0.25, S.usdToSar).maxCpaUsd, c.cpaAB[0]!);
      close(roasNeeded(r, "margin", 0.35, S.usdToSar).maxCpaUsd, c.cpaAB[1]!);
      close(roasNeeded(r, "profit", 60, S.usdToSar).roas, c.roasOrder[0]!);
      close(roasNeeded(r, "profit", 120, S.usdToSar).roas, c.roasOrder[1]!);
      close(roasNeeded(r, "profitPerUnit", 50, S.usdToSar).roas, c.roasUnit50);
      const marginTarget = data.targets.find((t) => t.metric === "margin")!;
      expect(statusAgainst(r, marginTarget)).toBe("a");
    });
  }

  it("overall status is the worst across enabled targets", () => {
    const r = evaluateOffer(ultra, offer(ultra, "Buy 2 get 1 free"), S);
    // CML % 33.2 → A; CML/order 202 → B; worst = A.
    expect(overallStatus(r, data.targets)).toBe("a");
    expect(overallStatus(r, [])).toBeNull();
  });
});

describe("§11.2 variants of 15% off on Ultra 3", () => {
  const o = offer(ultra, "15% off");
  it("undelivered cost 25 SAR", () => {
    const r = evaluateOffer(ultra, o, { ...S, undeliveredCost: 25 });
    close(r.undelivered, 4.41);
    close(r.profit, 66.78);
    closePct(r.margin, 25.82);
    close(r.accountantRoas, 2.54);
    closePct(r.adCostPct, 39.39);
  });
  it("adMode ROAS, platform ROAS 4.0", () => {
    const r = evaluateOffer(ultra, { ...o, adMode: "roas", platformRoas: 4 }, S);
    close(r.adSpend, 74.375);
    close(r.cpaUsd, 19.83);
    close(r.profit, 81.2);
    closePct(r.margin, 31.39);
  });
  it("prices excl. VAT", () => {
    const r = evaluateOffer(ultra, o, { ...S, pricesIncludeVat: false });
    close(r.paidGross, 342.13);
    close(r.netRevenue, 297.5);
    close(r.profit, 110);
    closePct(r.margin, 36.97);
    close(r.platformRoas, 4.13);
  });
  it("own delivery rate 90%", () => {
    const r = evaluateOffer(ultra, { ...o, deliveryRateOverride: 0.9 }, S);
    close(r.marketing, 92.08);
    close(r.profit, 76.61);
    closePct(r.margin, 29.61);
  });
  it("amount 100 SAR off × 2 units, coupon 5%", () => {
    const r = evaluateOffer(
      ultra,
      { ...o, mechanic: { kind: "amount", qty: 2, amount: 100 }, couponDiscount: 0.05 },
      S,
    );
    close(r.paidGross, 570);
    closePct(r.discount, 18.57);
    close(r.netRevenue, 495.65);
    close(r.profit, 218.15);
    close(r.profitPerUnit, 109.08);
  });
  it("bundle 3 units for 899", () => {
    const r = evaluateOffer(ultra, { ...o, mechanic: { kind: "bundle", qty: 3, price: 899 } }, S);
    close(r.paidGross, 899);
    closePct(r.discount, 14.38);
    close(r.netRevenue, 781.74);
    close(r.profit, 414.24);
  });
});

describe("§11.3 plan: sample data, 100 orders/day, even split", () => {
  const plan = data.plans[0]!;
  const lines = planLines(plan, data.products, S);
  const b = blend(lines, S);
  it("lines", () => {
    expect(lines).toHaveLength(15);
    for (const l of lines) {
      close(l.orders, 6.67, 0.005);
      close(l.share, 0.0667, 0.0001);
    }
  });
  it("per-day totals", () => {
    close(b.orders, 100);
    close(b.delivered, 85);
    close(b.units, 170);
    close(b.gross, 52113, 0.5);
    close(b.netRevenue, 38518.3, 0.01);
    close(b.adSpend, 10041.75, 0.01);
    close(b.adSpend / S.usdToSar, 2677.8, 0.01);
    close(b.cogs, 16558, 0.01);
    close(b.profit, 11918.55, 0.01);
  });
  it("ratios", () => {
    close(b.platformRoas, 5.19);
    close(b.accountantRoas, 3.84);
    close(b.cpaUsd, 26.78);
    closePct(b.margin, 30.94);
    closePct(b.cogsPct, 42.99);
    closePct(b.marketingPct, 26.07);
    close(b.margin + b.cogsPct + b.marketingPct + b.undeliveredPct, 1, 1e-9);
  });
  it("ROAS for targets", () => {
    close(roasFor(b, "margin", 0.25), 4.23);
    close(roasFor(b, "margin", 0.35), 6.15);
    close(roasFor(b, "profit", 60), 3.09);
    close(roasFor(b, "profit", 120), 4.43);
  });
  it("second plan: 60/day, Ultra 3 + Earbuds", () => {
    const u = ultra.offers;
    const e = earbuds.offers;
    const second: Plan = {
      id: "p2",
      name: "Second",
      ordersPerDay: 60,
      productShare: Object.fromEntries(data.products.map((p) => [p.id, p === ultra || p === earbuds ? 0.5 : 0])),
      offerShare: {
        [u[0]!.id]: 0.7, [u[1]!.id]: 0.3, [u[2]!.id]: 0,
        [e[0]!.id]: 1 / 3, [e[1]!.id]: 1 / 3, [e[2]!.id]: 1 / 3,
      },
    };
    const l2 = planLines(second, data.products, S);
    const by = (p: Product, i: number) => l2.find((x) => x.product === p && x.offer === p.offers[i])!;
    close(by(ultra, 0).orders, 21);
    close(by(ultra, 1).orders, 9);
    close(by(ultra, 2).orders, 0);
    for (let i = 0; i < 3; i++) close(by(earbuds, i).orders, 10);
    const b2 = blend(l2, S);
    close(b2.platformRoas, 4.8);
    close(b2.accountantRoas, 3.55);
    close(b2.cpaUsd, 19.61);
    closePct(b2.margin, 33.77);
    close(b2.profit, 5292.37, 0.01);
  });
});

describe("§11.4 actual vs plan: October 2026", () => {
  const period: ActualPeriod = {
    id: "oct",
    name: "October 2026",
    days: 31,
    adSpendUsd: 52000,
    metaRoas: 3.4,
    deliveryRate: null,
    orders: {
      [orderKey(ultra.id, ultra.offers[0]!.id)]: 900,
      [orderKey(ultra.id, ultra.offers[1]!.id)]: 300,
      [orderKey(earbuds.id, earbuds.offers[0]!.id)]: 1100,
    },
  };
  const { baked, actual, days } = actualBlends(period, data.products, S);
  const T = (x: number) => x * days;
  it("ROAS and gap", () => {
    close(baked.platformRoas, 4.17);
    close(actual.platformRoas, 3.4);
    close(actual.platformRoas / baked.platformRoas - 1, -0.184, 0.0005);
    close(roasFor(baked, "margin", 0.25), 3.53);
    expect(actual.platformRoas < roasFor(baked, "margin", 0.25)).toBe(true); // Miss
  });
  it("spend, CPA and CML for the period", () => {
    close(T(baked.adSpend) / S.usdToSar, 42444, 0.5);
    close(actual.cpaUsd, 22.61);
    close(baked.cpaUsd, 18.45);
    close(T(actual.profit), 115871, 0.5);
    close(T(baked.profit), 151706, 0.5);
    closePct(actual.margin, 23.62);
    closePct(baked.margin, 30.92);
    closePct(actual.cogsPct, 36.64);
    closePct(actual.marketingPct, 39.74);
    close(actual.accountantRoas, 2.52);
  });
});

describe("§11.5 goal seek", () => {
  const b2g1 = offer(ultra, "Buy 2 get 1 free");
  const p15 = offer(ultra, "15% off");
  it("B2G1 · unit list price · CML % 25% → ≥ 311.72, already", () => {
    const g = goalSeek(ultra, b2g1, S, "price", "margin", 0.25);
    expect(g.kind).toBe("solved");
    if (g.kind !== "solved") return;
    close(g.value, 311.72);
    expect(g.direction).toBe("gte");
    expect(g.alreadyMet).toBe(true);
    expect(g.now).toBe(350);
  });
  it("B2G1 · CPA · CML % 25% → ≤ $42.28, already", () => {
    const g = goalSeek(ultra, b2g1, S, "cpaUsd", "margin", 0.25);
    expect(g.kind).toBe("solved");
    if (g.kind !== "solved") return;
    close(g.value, 42.28);
    expect(g.direction).toBe("lte");
    expect(g.alreadyMet).toBe(true);
  });
  it("15% off · CPA · CML % 35% → ≤ $17.71, not met, −19.8%", () => {
    const g = goalSeek(ultra, p15, S, "cpaUsd", "margin", 0.35);
    expect(g.kind).toBe("solved");
    if (g.kind !== "solved") return;
    close(g.value, 17.71);
    expect(g.alreadyMet).toBe(false);
    close(g.value / g.now - 1, -0.198, 0.0005);
  });
  it("15% off · extra discount · CML % 25% → ≤ 3.4%, already", () => {
    const g = goalSeek(ultra, p15, S, "addDiscount", "margin", 0.25);
    expect(g.kind).toBe("solved");
    if (g.kind !== "solved") return;
    close(g.value, 0.034, 0.0005);
    expect(g.direction).toBe("lte");
    expect(g.alreadyMet).toBe(true);
    expect(g.now).toBe(0);
  });
  it("B2G1 · delivery rate · CML % 25% → ≥ 62.2%, already", () => {
    const g = goalSeek(ultra, b2g1, S, "deliveryRate", "margin", 0.25);
    expect(g.kind).toBe("solved");
    if (g.kind !== "solved") return;
    close(g.value, 0.622, 0.0005);
    expect(g.direction).toBe("gte");
    expect(g.alreadyMet).toBe(true);
  });
  it("an unreachable target and an always-met one", () => {
    // Even a free product cannot reach CML % 200%.
    expect(goalSeek(ultra, p15, S, "unitCost", "margin", 2).kind).toBe("unreachable");
    // A COGS % ceiling of 100% holds for every unit cost in range? No — but a
    // CML % floor of −10,000% holds for every CPA in range.
    expect(goalSeek(ultra, p15, S, "cpaUsd", "margin", -100).kind).toBe("always");
  });
});

describe("§11.6 identities", () => {
  it("roasFor(blend([offer])) equals roasNeeded(offer) for every metric", () => {
    for (const p of data.products) {
      for (const o of p.offers) {
        const r = evaluateOffer(p, o, S);
        const b = blend([{ product: p, offer: o, orders: 10, share: 1, r }], S);
        close(roasFor(b, "margin", 0.25), roasNeeded(r, "margin", 0.25, S.usdToSar).roas, 1e-9);
        close(roasFor(b, "profit", 60), roasNeeded(r, "profit", 60, S.usdToSar).roas, 1e-9);
        close(roasFor(b, "profitPerUnit", 50), roasNeeded(r, "profitPerUnit", 50, S.usdToSar).roas, 1e-9);
      }
    }
  });
  it("a blend run at exactly the ROAS for a target hits that target", () => {
    const plan = evenPlan("even", data.products);
    const lines = planLines(plan, data.products, S);
    const b = blend(lines, S);
    const at = (metric: "margin" | "profit" | "profitPerUnit", v: number) => {
      const roas = roasFor(b, metric, v);
      return blend(lines, S, b.gross / roas);
    };
    close(at("margin", 0.3).margin, 0.3, 1e-9);
    close(at("profit", 100).profit / at("profit", 100).delivered, 100, 1e-6);
    close(at("profitPerUnit", 40).profit / at("profitPerUnit", 40).units, 40, 1e-6);
  });
  it("ad spend ×1.25 → ROAS ÷ 1.25", () => {
    const lines = planLines(data.plans[0]!, data.products, S);
    const b = blend(lines, S);
    const b2 = blend(lines, S, b.adSpend * 1.25);
    close(b2.platformRoas, b.platformRoas / 1.25, 1e-9);
  });
});
