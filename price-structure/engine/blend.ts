import { evaluateOffer, type OfferResult } from "./evaluate";
import type { RoasTargetMetric } from "./targets";
import { orderKey, type ActualPeriod, type Offer, type Plan, type Product, type Settings } from "./types";

/**
 * Blending many offers (brief §5.4): the Plan and Actual pages.
 *
 * A LINE is one offer with `orders` = placed orders PER DAY and `share` = its
 * share of all orders. The blend is a weighted sum via component totals —
 * never an average of per-line ratios.
 */
export interface Line {
  product: Product;
  offer: Offer;
  /** Placed orders per day. */
  orders: number;
  /** Share of all orders, 0–1. */
  share: number;
  r: OfferResult;
}

export interface Blend {
  /** Placed per day. */
  orders: number;
  delivered: number;
  units: number;
  /** What the ad platform counts: placed orders × customer pays (incl. VAT). */
  gross: number;
  /** Delivered orders × net revenue. */
  netRevenue: number;
  /** SAR per day: the lines' CPA/ROAS spend, or the actuals override. */
  adSpend: number;
  undelivered: number;
  cogs: number;
  contribution: number;
  /** CML. */
  profit: number;
  /** CML %. */
  margin: number;
  cogsPct: number;
  marketingPct: number;
  undeliveredPct: number;
  platformRoas: number;
  accountantRoas: number;
  cpaUsd: number;
}

export function blend(
  lines: readonly Line[],
  settings: Settings,
  adSpendOverride?: number,
): Blend {
  let orders = 0;
  let delivered = 0;
  let units = 0;
  let gross = 0;
  let netRevenue = 0;
  let spend = 0;
  let undelivered = 0;
  let cogs = 0;
  let contribution = 0;
  for (const line of lines) {
    const n = line.orders;
    if (!(n > 0)) continue;
    const r = line.r;
    const d = n * r.deliveryRate;
    orders += n;
    delivered += d;
    units += d * r.units;
    gross += n * r.paidGross;
    netRevenue += d * r.netRevenue;
    spend += n * r.adSpend;
    undelivered += d * r.undelivered;
    cogs += d * r.cogs;
    contribution += d * r.contribution;
  }
  const adSpend = adSpendOverride ?? spend;
  const profit = contribution - adSpend;
  const share = (x: number) => (netRevenue === 0 ? 0 : x / netRevenue);
  return {
    orders,
    delivered,
    units,
    gross,
    netRevenue,
    adSpend,
    undelivered,
    cogs,
    contribution,
    profit,
    margin: share(profit),
    cogsPct: share(cogs),
    marketingPct: share(adSpend),
    undeliveredPct: share(undelivered),
    platformRoas: adSpend > 0 ? gross / adSpend : Infinity,
    accountantRoas: adSpend + undelivered > 0 ? netRevenue / (adSpend + undelivered) : Infinity,
    cpaUsd: orders > 0 ? adSpend / orders / settings.usdToSar : 0,
  };
}

/**
 * The platform ROAS a whole mix needs for a CML target level, with ad spend
 * scaled evenly across its offers (brief §5.4). For a single offer this equals
 * `roasNeeded(...).roas`.
 */
export function roasFor(b: Blend, metric: RoasTargetMetric, v: number): number {
  const keep =
    metric === "margin" ? v * b.netRevenue : metric === "profitPerUnit" ? v * b.units : v * b.delivered;
  const maxSpend = b.contribution - keep;
  return maxSpend > 0 ? b.gross / maxSpend : Infinity;
}

/** Non-negative weight, missing = 0. */
const w = (v: number | undefined) => Math.max(0, v ?? 0);

/**
 * A plan's lines (brief §5.4): every offer of every product, in product order
 * then offer order; shares normalised across products and within each product.
 */
export function planLines(plan: Plan, products: readonly Product[], settings: Settings): Line[] {
  const P = products.reduce((sum, p) => sum + w(plan.productShare[p.id]), 0);
  const lines: Line[] = [];
  for (const product of products) {
    const pw = w(plan.productShare[product.id]);
    const O = product.offers.reduce((sum, o) => sum + w(plan.offerShare[o.id]), 0);
    for (const offer of product.offers) {
      const ow = w(plan.offerShare[offer.id]);
      const share = P > 0 && O > 0 ? (pw / P) * (ow / O) : 0;
      lines.push({
        product,
        offer,
        share,
        orders: plan.ordersPerDay * share,
        r: evaluateOffer(product, offer, settings),
      });
    }
  }
  return lines;
}

/**
 * An actual period's lines (brief §5.4): orders per day = period orders ÷
 * days; the period's own delivery rate, when set, overrides every offer's.
 */
export function actualLines(
  period: ActualPeriod,
  products: readonly Product[],
  settings: Settings,
): Line[] {
  const days = Math.max(1, period.days);
  const ov = period.deliveryRate !== null ? { deliveryRate: period.deliveryRate } : {};
  const lines: Line[] = [];
  let total = 0;
  for (const product of products) {
    for (const offer of product.offers) {
      const n = Math.max(0, period.orders[orderKey(product.id, offer.id)] ?? 0);
      total += n;
      lines.push({ product, offer, share: 0, orders: n / days, r: evaluateOffer(product, offer, settings, ov) });
    }
  }
  if (total > 0) for (const line of lines) line.share = (line.orders * days) / total;
  return lines;
}

/** The two blends of an actual period: at the offers' own CPAs, and at real spend. */
export function actualBlends(
  period: ActualPeriod,
  products: readonly Product[],
  settings: Settings,
): { lines: Line[]; baked: Blend; actual: Blend; days: number } {
  const days = Math.max(1, period.days);
  const lines = actualLines(period, products, settings);
  return {
    lines,
    days,
    baked: blend(lines, settings),
    actual: blend(lines, settings, (period.adSpendUsd * settings.usdToSar) / days),
  };
}

/** The sum of a period's orders. */
export function periodTotalOrders(period: ActualPeriod): number {
  return Object.values(period.orders).reduce((s, n) => s + Math.max(0, n ?? 0), 0);
}
