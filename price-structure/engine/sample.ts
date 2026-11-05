import { newId } from "./ids";
import { evenShares } from "./shares";
import { DEFAULT_SETTINGS, type Offer, type Plan, type Product, type Target, type VersionData } from "./types";

/**
 * Sample data (brief §10): five products, three offers each, two targets, one
 * base plan, no actuals. Also the fixture every engine acceptance test (§11)
 * runs against, so the numbers here are the contract's.
 */
const ESTIMATE_NOTE =
  "CPA is an estimate (midpoint of the other two offers). Replace it with real data.";

const SAMPLE_PRODUCTS: ReadonlyArray<{
  name: string;
  unitCost: number;
  price: number;
  cpa: [number, number, number];
}> = [
  { name: "Urjwan Watch Ultra 3", unitCost: 90, price: 350, cpa: [22.1, 30.96, 26.53] },
  { name: "Urjwan Watch Gen 11", unitCost: 86, price: 299, cpa: [18.07, 25.32, 21.7] },
  { name: "Urjwan Earbuds (Pro 3 / 4)", unitCost: 45, price: 199, cpa: [12.06, 16.88, 14.47] },
  { name: "Ultra 3 Bundle", unitCost: 135, price: 499, cpa: [31.16, 43.63, 37.4] },
  { name: "Economy Bundle", unitCost: 131, price: 450, cpa: [28.18, 39.41, 33.8] },
];

export function baseOffer(partial: Partial<Offer> & Pick<Offer, "name" | "mechanic">): Offer {
  return {
    id: newId(),
    couponDiscount: 0,
    adMode: "cpa",
    cpaUsd: 20,
    platformRoas: 4,
    deliveryRateOverride: null,
    ordersPerMonth: 0,
    notes: "",
    ...partial,
  };
}

function sampleOffers(cpa: [number, number, number]): Offer[] {
  return [
    baseOffer({ name: "15% off", mechanic: { kind: "percent", qty: 1, pct: 0.15 }, cpaUsd: cpa[0] }),
    baseOffer({ name: "Buy 2 get 1 free", mechanic: { kind: "bxgy", buy: 2, get: 1 }, cpaUsd: cpa[1] }),
    baseOffer({
      name: "Buy 1 get 1 at 50% off",
      mechanic: { kind: "bxgy_pct", buy: 1, get: 1, pct: 0.5 },
      cpaUsd: cpa[2],
      notes: ESTIMATE_NOTE,
    }),
  ];
}

export function sampleProducts(): Product[] {
  return SAMPLE_PRODUCTS.map((p, i) => ({
    id: newId(),
    name: p.name,
    sku: "",
    unitCost: p.unitCost,
    price: p.price,
    colorSlot: i,
    offers: sampleOffers(p.cpa),
    notes: "",
  }));
}

export function sampleTargets(): Target[] {
  return [
    { id: newId(), metric: "margin", a: 0.25, b: 0.35, enabled: true },
    { id: newId(), metric: "profit", a: 60, b: 120, enabled: true },
  ];
}

/** "Base plan": 100 orders/day, even split. */
export function evenPlan(name: string, products: readonly Product[], ordersPerDay = 100): Plan {
  return { id: newId(), name, ordersPerDay, ...evenShares(products) };
}

export function sampleVersionData(): VersionData {
  const products = sampleProducts();
  const plan = evenPlan("Base plan", products);
  return {
    settings: { ...DEFAULT_SETTINGS },
    products,
    targets: sampleTargets(),
    roasTargetId: "",
    plans: [plan],
    activePlanId: plan.id,
    actuals: [],
  };
}

/** Blank: default settings, no products, no targets, one empty plan, no actuals. */
export function blankVersionData(): VersionData {
  const plan: Plan = { id: newId(), name: "Base plan", ordersPerDay: 100, productShare: {}, offerShare: {} };
  return {
    settings: { ...DEFAULT_SETTINGS },
    products: [],
    targets: [],
    roasTargetId: "",
    plans: [plan],
    activePlanId: plan.id,
    actuals: [],
  };
}

/** The "+ Add" product (brief §6.2): a new product with one full-price offer. */
export function newProduct(colorSlot: number): Product {
  return {
    id: newId(),
    name: "New product",
    sku: "",
    unitCost: 50,
    price: 199,
    colorSlot,
    offers: [baseOffer({ name: "Full price", mechanic: { kind: "percent", qty: 1, pct: 0 } })],
    notes: "",
  };
}

/** The first colour slot (0–7) no product uses; wraps to the least-used one. */
export function nextColorSlot(products: readonly Product[]): number {
  const used = new Map<number, number>();
  for (const p of products) used.set(p.colorSlot, (used.get(p.colorSlot) ?? 0) + 1);
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  let best = 0;
  for (let i = 1; i < 8; i++) if ((used.get(i) ?? 0) < (used.get(best) ?? 0)) best = i;
  return best;
}

/** The offer templates of the "+ Add offer" select (brief §6.2). */
export const OFFER_TEMPLATES: ReadonlyArray<{ key: string; name: string; mechanic: Offer["mechanic"] }> = [
  { key: "full", name: "Full price", mechanic: { kind: "percent", qty: 1, pct: 0 } },
  { key: "p10", name: "10% off", mechanic: { kind: "percent", qty: 1, pct: 0.1 } },
  { key: "p15", name: "15% off", mechanic: { kind: "percent", qty: 1, pct: 0.15 } },
  { key: "p20", name: "20% off", mechanic: { kind: "percent", qty: 1, pct: 0.2 } },
  { key: "b1g1h", name: "Buy 1 get 1 at 50% off", mechanic: { kind: "bxgy_pct", buy: 1, get: 1, pct: 0.5 } },
  { key: "b1g1", name: "Buy 1 get 1 free", mechanic: { kind: "bxgy", buy: 1, get: 1 } },
  { key: "b2g1", name: "Buy 2 get 1 free", mechanic: { kind: "bxgy", buy: 2, get: 1 } },
];
