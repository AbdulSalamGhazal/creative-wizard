import { describe, expect, it } from "vitest";
import { evaluateOffer, safeDiv } from "./evaluate";
import { convertMechanic, mechanicText } from "./mechanics";
import { rankCompare, statusOf } from "./metrics";
import { baseOffer, nextColorSlot, sampleVersionData } from "./sample";
import { copyMixFromPeriod, normaliseShares, sharesOff } from "./shares";
import { resolveRoasTarget, roasNeeded } from "./targets";
import { orderKey, type Target } from "./types";

describe("mechanic text (§5.1)", () => {
  it("reads the way the brief spells it", () => {
    expect(mechanicText({ kind: "percent", qty: 1, pct: 0 })).toBe("Full price");
    expect(mechanicText({ kind: "percent", qty: 3, pct: 0 })).toBe("3 units, full price");
    expect(mechanicText({ kind: "percent", qty: 1, pct: 0.15 })).toBe("15% off");
    expect(mechanicText({ kind: "percent", qty: 2, pct: 0.125 })).toBe("12.5% off × 2 units");
    expect(mechanicText({ kind: "amount", qty: 1, amount: 100 })).toBe("100 SAR off");
    expect(mechanicText({ kind: "amount", qty: 2, amount: 100 })).toBe("100 SAR off × 2 units");
    expect(mechanicText({ kind: "bxgy", buy: 2, get: 1 })).toBe("Buy 2 get 1 free");
    expect(mechanicText({ kind: "bxgy_pct", buy: 1, get: 1, pct: 0.5 })).toBe("Buy 1 get 1 at 50% off");
    expect(mechanicText({ kind: "bundle", qty: 3, price: 899 })).toBe("3 units for 899 SAR");
  });

  it("converting a type keeps sensible values (§6.2)", () => {
    const b2g1 = { kind: "bxgy", buy: 2, get: 1 } as const;
    expect(convertMechanic(b2g1, "percent", 350)).toEqual({ kind: "percent", qty: 3, pct: 0.1 });
    expect(convertMechanic({ kind: "percent", qty: 1, pct: 0.15 }, "amount", 350)).toEqual({ kind: "amount", qty: 1, amount: 35 });
    expect(convertMechanic({ kind: "percent", qty: 1, pct: 0.15 }, "bxgy", 350)).toEqual({ kind: "bxgy", buy: 2, get: 1 });
    expect(convertMechanic(b2g1, "bxgy_pct", 350)).toEqual({ kind: "bxgy_pct", buy: 2, get: 1, pct: 0.5 });
    expect(convertMechanic({ kind: "percent", qty: 1, pct: 0.15 }, "bundle", 350)).toEqual({ kind: "bundle", qty: 2, price: 560 });
    expect(convertMechanic({ kind: "bundle", qty: 4, price: 1000 }, "percent", 350)).toEqual({ kind: "percent", qty: 4, pct: 0.1 });
  });
});

describe("safe division and infinities", () => {
  it("x ÷ 0", () => {
    expect(safeDiv(0, 0)).toBe(0);
    expect(safeDiv(5, 0)).toBe(Infinity);
    expect(safeDiv(-5, 0)).toBe(-Infinity);
  });
  it("a free offer with no ads never produces NaN", () => {
    const data = sampleVersionData();
    const p = { ...data.products[0]!, price: 0 };
    const o = baseOffer({ name: "x", mechanic: { kind: "percent", qty: 1, pct: 0 }, cpaUsd: 0 });
    const r = evaluateOffer(p, o, data.settings);
    expect(Number.isNaN(r.margin)).toBe(false);
    expect(r.platformRoas).toBe(0);
    expect(roasNeeded(r, "margin", 0.25, 3.75).roas).toBe(Infinity);
    expect(Number.isNaN(roasNeeded(r, "margin", 0.25, 3.75).maxCpaUsd)).toBe(true);
  });
});

describe("status (§5.6)", () => {
  it("compares with the metric's direction", () => {
    expect(statusOf(0.4, 0.25, 0.35, true)).toBe("b");
    expect(statusOf(0.3, 0.25, 0.35, true)).toBe("a");
    expect(statusOf(0.2, 0.25, 0.35, true)).toBe("miss");
    expect(statusOf(0.25, 0.25, 0.35, true)).toBe("a"); // ≥ passes
    expect(statusOf(0.3, 0.4, 0.3, false)).toBe("b"); // lower is better: ≤ b
    expect(statusOf(0.35, 0.4, 0.3, false)).toBe("a");
    expect(statusOf(0.5, 0.4, 0.3, false)).toBe("miss");
  });
  it("infinite and NaN values", () => {
    expect(statusOf(Infinity, 1, 2, true)).toBe("b");
    expect(statusOf(-Infinity, 1, 2, true)).toBe("miss");
    expect(statusOf(-Infinity, 1, 2, false)).toBe("b");
    expect(statusOf(Infinity, 1, 2, false)).toBe("miss");
    expect(statusOf(NaN, 1, 2, true)).toBe("miss");
  });
  it("ranking puts the best first and ±∞ at the right end", () => {
    expect([1, Infinity, 3, NaN, -Infinity].sort(rankCompare("margin"))).toEqual([Infinity, 3, 1, -Infinity, NaN]);
    expect([0.5, Infinity, 0.1, -Infinity].sort(rankCompare("cogsPct"))).toEqual([-Infinity, 0.1, 0.5, Infinity]);
  });
});

describe("the ROAS target (§5.6)", () => {
  const t = (id: string, metric: Target["metric"], enabled = true): Target => ({ id, metric, a: 1, b: 2, enabled });
  it("resolution order", () => {
    const targets = [t("x", "platformRoas"), t("p", "profit"), t("m", "margin"), t("u", "profitPerUnit")];
    expect(resolveRoasTarget(targets, "")?.id).toBe("m");
    expect(resolveRoasTarget(targets, "u")?.id).toBe("u");
    expect(resolveRoasTarget(targets, "x")?.id).toBe("m"); // not eligible → default
    expect(resolveRoasTarget([t("x", "platformRoas"), t("p", "profit")], "")?.id).toBe("p");
    expect(resolveRoasTarget([t("m", "margin", false)], "")).toBeNull();
    expect(resolveRoasTarget([], "")).toBeNull();
  });
});

describe("shares (§6.4)", () => {
  const data = sampleVersionData();
  const plan = data.plans[0]!;
  it("an even plan adds up; a nudged one does not; normalising fixes it", () => {
    expect(sharesOff(plan, data.products)).toBe(false);
    const p0 = data.products[0]!;
    const nudged = { ...plan, productShare: { ...plan.productShare, [p0.id]: 0.5 } };
    expect(sharesOff(nudged, data.products)).toBe(true);
    const fixed = normaliseShares(nudged, data.products);
    expect(sharesOff(fixed, data.products)).toBe(false);
    expect(fixed.productShare[p0.id]).toBeCloseTo(0.5 / 1.3, 9);
  });
  it("copy mix & volume from a period", () => {
    const p0 = data.products[0]!;
    const p1 = data.products[1]!;
    const period = {
      id: "x", name: "x", days: 30, adSpendUsd: 0, metaRoas: null, deliveryRate: null,
      orders: { [orderKey(p0.id, p0.offers[0]!.id)]: 300, [orderKey(p0.id, p0.offers[1]!.id)]: 100, [orderKey(p1.id, p1.offers[2]!.id)]: 200 },
    };
    const next = copyMixFromPeriod(plan, period, data.products);
    expect(next.ordersPerDay).toBe(20);
    expect(next.productShare[p0.id]).toBeCloseTo(400 / 600, 9);
    expect(next.productShare[p1.id]).toBeCloseTo(200 / 600, 9);
    expect(next.productShare[data.products[2]!.id]).toBe(0);
    expect(next.offerShare[p0.offers[0]!.id]).toBeCloseTo(0.75, 9);
    expect(next.offerShare[p0.offers[2]!.id]).toBe(0);
    expect(next.offerShare[p1.offers[2]!.id]).toBe(1);
    // A product with no orders keeps its offer shares.
    expect(next.offerShare[data.products[2]!.offers[0]!.id]).toBeCloseTo(1 / 3, 9);
    // A period with no orders changes nothing.
    expect(copyMixFromPeriod(plan, { ...period, orders: {} }, data.products)).toBe(plan);
  });
});

describe("colour slots", () => {
  it("the first unused slot, then the least used", () => {
    const data = sampleVersionData(); // slots 0–4
    expect(nextColorSlot(data.products)).toBe(5);
    expect(nextColorSlot([])).toBe(0);
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...data.products[0]!, id: String(i), colorSlot: i }));
    expect(nextColorSlot([...eight, { ...eight[0]!, id: "9", colorSlot: 0 }])).toBe(1);
  });
});
