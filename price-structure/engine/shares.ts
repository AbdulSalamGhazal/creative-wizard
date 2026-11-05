import { periodTotalOrders } from "./blend";
import { orderKey, type ActualPeriod, type Plan, type Product } from "./types";

/** Tolerance for "adds up to 100%": 0.05 percentage points. */
export const SHARE_TOLERANCE = 0.0005;

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + Math.max(0, x), 0);

export function productShareSum(plan: Plan, products: readonly Product[]): number {
  return sum(products.map((p) => plan.productShare[p.id] ?? 0));
}

export function offerShareSum(plan: Plan, product: Product): number {
  return sum(product.offers.map((o) => plan.offerShare[o.id] ?? 0));
}

function offBy(total: number): boolean {
  return Math.abs(total - 1) > SHARE_TOLERANCE;
}

/** Whether any share group in the plan fails to add up to 100% (brief §6.4). */
export function sharesOff(plan: Plan, products: readonly Product[]): boolean {
  if (products.length === 0) return false;
  if (offBy(productShareSum(plan, products))) return true;
  return products.some((p) => p.offers.length > 0 && offBy(offerShareSum(plan, p)));
}

/** "Make them 100%": divide each group by its sum (a zero-sum group is left alone). */
export function normaliseShares(plan: Plan, products: readonly Product[]): Plan {
  const productShare: Record<string, number> = { ...plan.productShare };
  const offerShare: Record<string, number> = { ...plan.offerShare };
  const P = productShareSum(plan, products);
  for (const p of products) {
    if (P > 0) productShare[p.id] = Math.max(0, plan.productShare[p.id] ?? 0) / P;
    const O = offerShareSum(plan, p);
    if (O > 0) for (const o of p.offers) offerShare[o.id] = Math.max(0, plan.offerShare[o.id] ?? 0) / O;
  }
  return { ...plan, productShare, offerShare };
}

/** Every product 1 ÷ n; every offer 1 ÷ its product's offer count. */
export function evenShares(products: readonly Product[]): Pick<Plan, "productShare" | "offerShare"> {
  const productShare: Record<string, number> = {};
  const offerShare: Record<string, number> = {};
  for (const p of products) {
    productShare[p.id] = products.length > 0 ? 1 / products.length : 0;
    for (const o of p.offers) offerShare[o.id] = p.offers.length > 0 ? 1 / p.offers.length : 0;
  }
  return { productShare, offerShare };
}

/**
 * "Copy mix & volume from…" an actual period (brief §6.4): product shares from
 * the period's orders, offer shares within the products that had orders (the
 * others keep theirs), orders/day = total ÷ days rounded to 1 decimal. A period
 * with no orders changes nothing.
 */
export function copyMixFromPeriod(plan: Plan, period: ActualPeriod, products: readonly Product[]): Plan {
  const total = periodTotalOrders(period);
  if (total <= 0) return plan;
  const days = Math.max(1, period.days);
  const productShare: Record<string, number> = { ...plan.productShare };
  const offerShare: Record<string, number> = { ...plan.offerShare };
  for (const p of products) {
    const perOffer = p.offers.map((o) => Math.max(0, period.orders[orderKey(p.id, o.id)] ?? 0));
    const pTotal = perOffer.reduce((s, n) => s + n, 0);
    productShare[p.id] = pTotal / total;
    if (pTotal > 0) p.offers.forEach((o, i) => (offerShare[o.id] = perOffer[i]! / pTotal));
  }
  return { ...plan, productShare, offerShare, ordersPerDay: Math.round((total / days) * 10) / 10 };
}
