import { evaluateOffer, type OfferResult } from "../engine/evaluate";
import { planLines } from "../engine/blend";
import type { Offer, Plan, Product, VersionData } from "../engine/types";
import {
  skuOfferKey,
  type ActualFacts,
  type ActualMappings,
  type DeliveryRateFact,
  type Outcome,
} from "./facts";

/**
 * Pricing · Actual — the REAL-money CML of a date range (user decisions
 * 2026-11-27). Pure: no I/O, the same function runs wherever it is called,
 * and every figure the page shows comes from here.
 *
 *   CML = net revenue − COGS − ad spend
 *   net revenue = delivered orders' (total − VAT)
 *               + open orders' (total − VAT) × their payment method's delivery rate
 *   lost orders (cancelled, deleted, refunded) bring no revenue and no COGS;
 *   their ad spend still counts (it was spent).
 *
 * Shipping and COD fees the customer paid ARE revenue (user decision); the
 * real shipping cost is outside CML. Every blended figure is a sum of
 * components; ratios divide totals.
 */

/** A payment method needs this many closed orders before its own rate is used. */
export const MIN_CLOSED_FOR_RATE = 20;

/** No payment method is ever named this, so `rateOf` falls through to the brand's rate. */
const UPLOADED_RATE_KEY = "\u0001uploaded";

export type RateSource = "method" | "brand" | "version";

export interface OpenRow {
  paymentMethod: string;
  open: number;
  /** Placed orders that ended delivered, over the trailing window's closed orders. */
  rate: number;
  rateSource: RateSource;
  closed: number;
  openNet: number;
  expectedNet: number;
}

/** Money of a group, already weighted by outcome (delivered 1 · open × rate · lost 0). */
export interface Money {
  /** Placed: every line or order, whatever happened to it. */
  placed: number;
  /** Delivered-equivalent: delivered + open × rate. */
  delivered: number;
  units: number;
  revenue: number;
  cogs: number;
  uncostedUnits: number;
}

export interface OfferRow extends Money {
  /** null = this product's lines whose quantity has no offer mapped. */
  offerId: string | null;
  name: string;
}

export interface ProductRow extends Money {
  productId: string;
  name: string;
  colorSlot: number;
  offers: OfferRow[];
  adSpend: number;
  /** revenue − cogs − adSpend. */
  cml: number;
}

export interface SkuRow extends Money {
  productKey: string;
  name: string | null;
  /** The SKU is mapped, but to a product this version doesn't have. */
  notInVersion: boolean;
}

export interface AdRow {
  productId: string;
  productName: string;
  spend: number;
}

export interface BridgeStep {
  key: "plan" | "volume" | "mix" | "delivery" | "price" | "cogs" | "ads" | "notInPlan" | "actual";
  value: number;
}

export interface ActualResult {
  days: number;
  /** False when a delivered or open unit has no cost, or an order has no products: CML is withheld. */
  complete: boolean;
  uncostedUnits: number;
  uncostedSkus: string[];
  ordersWithoutProducts: number;
  counts: Record<Outcome, number> & { all: number };
  storeTotalInclVat: number;
  vat: number;
  /** total − VAT over every order. */
  netAll: number;
  lostNet: number;
  openNet: number;
  openExpectedNet: number;
  /** Open orders' net expected to fail: openNet − openExpectedNet. */
  openFailNet: number;
  /** Uploaded orders (no status): their net, and what the brand's rate expects of it. */
  uploadedNet: number;
  uploadedExpectedNet: number;
  uploadedFailNet: number;
  deliveredNet: number;
  netRevenue: number;
  cogs: number;
  deliveredCogs: number;
  adSpendUsd: number;
  adSpend: number;
  cml: number;
  settledCml: number;
  expectedCml: number;
  cmlPct: number;
  cogsPct: number;
  adPct: number;
  fees: number;
  withoutProductsNet: number;
  open: OpenRow[];
  products: ProductRow[];
  /** SKUs with no Pricing product, or one this version lacks. */
  unmapped: SkuRow[];
  /** Spend on Library products with no Pricing product (or one this version lacks). */
  adsNotMapped: AdRow[];
  adsNotMappedSpend: number;
  /** null when there is no plan to compare with (see `bridgeUnavailable`). */
  bridge: BridgeStep[] | null;
  bridgeUnavailable: "incomplete" | "no-plan" | "no-mapped-orders" | null;
}

const ratio = (x: number, y: number) => (y === 0 ? 0 : x / y);
const zero = (): Money => ({ placed: 0, delivered: 0, units: 0, revenue: 0, cogs: 0, uncostedUnits: 0 });
function add(into: Money, m: Money) {
  into.placed += m.placed;
  into.delivered += m.delivered;
  into.units += m.units;
  into.revenue += m.revenue;
  into.cogs += m.cogs;
  into.uncostedUnits += m.uncostedUnits;
}

/** Days in an inclusive ISO range. */
export function daysInRange(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * The delivery rate an open order is counted at: its payment method's own
 * closed orders when there are enough, else the brand's, else the version's
 * setting. Rate = delivered ÷ (delivered + lost).
 */
export function resolveRates(
  rates: readonly DeliveryRateFact[],
  fallback: number,
): { rateOf: (pm: string) => { rate: number; source: RateSource; closed: number } } {
  const byMethod = new Map(rates.map((r) => [r.paymentMethod, r]));
  const brandDelivered = rates.reduce((s, r) => s + r.delivered, 0);
  const brandClosed = rates.reduce((s, r) => s + r.delivered + r.lost, 0);
  return {
    rateOf(pm) {
      const r = byMethod.get(pm);
      const closed = r ? r.delivered + r.lost : 0;
      if (r && closed >= MIN_CLOSED_FOR_RATE) return { rate: r.delivered / closed, source: "method", closed };
      if (brandClosed >= MIN_CLOSED_FOR_RATE) return { rate: brandDelivered / brandClosed, source: "brand", closed };
      return { rate: fallback, source: "version", closed };
    },
  };
}

export function computeActual(
  facts: ActualFacts,
  mappings: ActualMappings,
  version: VersionData,
  plan: Plan | null,
): ActualResult {
  const { settings, products } = version;
  const days = daysInRange(facts.from, facts.to);
  const { rateOf } = resolveRates(facts.rates, settings.deliveryRate);
  // An uploaded order names no status (and, in practice, no payment method):
  // the brand's rate, whatever its payment cell says.
  const factor = (o: Outcome, pm: string) =>
    o === "delivered" ? 1 : o === "lost" ? 0 : o === "uploaded" ? rateOf(UPLOADED_RATE_KEY).rate : rateOf(pm).rate;

  // ── Orders: the store total down to net revenue ──────────────────────────
  const counts = { delivered: 0, open: 0, lost: 0, uploaded: 0, all: 0 };
  let uploadedNet = 0;
  let uploadedExpectedNet = 0;
  let storeTotalInclVat = 0;
  let vat = 0;
  let netAll = 0;
  let lostNet = 0;
  let openNet = 0;
  let openExpectedNet = 0;
  let deliveredNet = 0;
  let fees = 0;
  let withoutProductsNet = 0;
  let ordersWithoutProducts = 0;
  const openBy = new Map<string, OpenRow>();
  for (const o of facts.orders) {
    const f = factor(o.outcome, o.paymentMethod);
    counts[o.outcome] += o.orders;
    counts.all += o.orders;
    storeTotalInclVat += o.totalInclVat;
    vat += o.vat;
    netAll += o.net;
    fees += o.feesNet * f;
    withoutProductsNet += o.netWithoutLines * f;
    if (o.outcome !== "lost") ordersWithoutProducts += o.ordersWithoutLines;
    if (o.outcome === "lost") lostNet += o.net;
    else if (o.outcome === "delivered") deliveredNet += o.net;
    else if (o.outcome === "uploaded") {
      // No status: counted at the brand's rate, never in the open-orders table.
      uploadedNet += o.net;
      uploadedExpectedNet += o.net * f;
    } else {
      openNet += o.net;
      openExpectedNet += o.net * f;
      const r = rateOf(o.paymentMethod);
      const row = openBy.get(o.paymentMethod) ?? {
        paymentMethod: o.paymentMethod,
        open: 0,
        rate: r.rate,
        rateSource: r.source,
        closed: r.closed,
        openNet: 0,
        expectedNet: 0,
      };
      row.open += o.orders;
      row.openNet += o.net;
      row.expectedNet += o.net * f;
      openBy.set(o.paymentMethod, row);
    }
  }
  const netRevenue = deliveredNet + openExpectedNet + uploadedExpectedNet;

  // ── Lines: products, offers and the SKUs no product claims ──────────────
  const productById = new Map(products.map((p) => [p.id, p]));
  const productRows = new Map<string, ProductRow>();
  const offerRows = new Map<string, OfferRow>();
  const unmapped = new Map<string, SkuRow>();
  let cogs = 0;
  let deliveredCogs = 0;
  let uncostedUnits = 0;
  const uncostedSkus = new Set<string>();
  for (const l of facts.lines) {
    const f = factor(l.outcome, l.paymentMethod);
    const m: Money = {
      placed: l.lines,
      delivered: l.lines * f,
      units: l.units * f,
      revenue: l.revenue * f,
      cogs: l.cogs * f,
      // A lost line needs no cost: it carries none.
      uncostedUnits: l.outcome === "lost" ? 0 : l.uncostedUnits,
    };
    cogs += m.cogs;
    if (l.outcome === "delivered") deliveredCogs += l.cogs;
    uncostedUnits += m.uncostedUnits;
    if (m.uncostedUnits > 0) uncostedSkus.add(l.productKey);

    const psId = mappings.skuProduct[l.productKey];
    const product = psId ? productById.get(psId) : undefined;
    if (!product) {
      const row = unmapped.get(l.productKey) ?? { productKey: l.productKey, name: l.name, notInVersion: !!psId, ...zero() };
      add(row, m);
      unmapped.set(l.productKey, row);
      continue;
    }
    const prow =
      productRows.get(product.id) ??
      ({ productId: product.id, name: product.name, colorSlot: product.colorSlot, offers: [], adSpend: 0, cml: 0, ...zero() } satisfies ProductRow);
    add(prow, m);
    productRows.set(product.id, prow);
    const offerId = mappings.skuOffer[skuOfferKey(l.productKey, l.quantity)];
    const offer = offerId ? product.offers.find((o) => o.id === offerId) : undefined;
    const okey = `${product.id}:${offer?.id ?? ""}`;
    const orow = offerRows.get(okey) ?? { offerId: offer?.id ?? null, name: offer?.name ?? "No offer", ...zero() };
    add(orow, m);
    offerRows.set(okey, orow);
  }

  // ── Ad spend, by the creative's own product ─────────────────────────────
  const fx = settings.usdToSar;
  let adSpendUsd = 0;
  const adsNotMapped: AdRow[] = [];
  for (const a of facts.adSpend) {
    adSpendUsd += a.spendUsd;
    const psId = mappings.adProduct[a.productId];
    const product = psId ? productById.get(psId) : undefined;
    const sar = a.spendUsd * fx;
    if (!product) {
      adsNotMapped.push({ productId: a.productId, productName: a.productName, spend: sar });
      continue;
    }
    const prow =
      productRows.get(product.id) ??
      ({ productId: product.id, name: product.name, colorSlot: product.colorSlot, offers: [], adSpend: 0, cml: 0, ...zero() } satisfies ProductRow);
    prow.adSpend += sar;
    productRows.set(product.id, prow);
  }
  const adSpend = adSpendUsd * fx;
  const adsNotMappedSpend = adsNotMapped.reduce((s, a) => s + a.spend, 0);

  // Offers under their product, in the version's own order; "No offer" last.
  const productList: ProductRow[] = [];
  for (const p of products) {
    const row = productRows.get(p.id);
    if (!row) continue;
    const order = new Map(p.offers.map((o, i) => [o.id, i]));
    row.offers = [...offerRows.entries()]
      .filter(([k]) => k.startsWith(`${p.id}:`))
      .map(([, v]) => v)
      .sort((a, b) => (order.get(a.offerId ?? "") ?? 1e9) - (order.get(b.offerId ?? "") ?? 1e9));
    row.cml = row.revenue - row.cogs - row.adSpend;
    productList.push(row);
  }

  const cml = netRevenue - cogs - adSpend;
  const settledCml = deliveredNet - deliveredCogs - adSpend;
  const complete = uncostedUnits === 0 && ordersWithoutProducts === 0;
  const unmappedList = [...unmapped.values()].sort((a, b) => b.revenue - a.revenue);

  const result: ActualResult = {
    days,
    complete,
    uncostedUnits,
    uncostedSkus: [...uncostedSkus].sort(),
    ordersWithoutProducts,
    counts,
    storeTotalInclVat,
    vat,
    netAll,
    lostNet,
    openNet,
    openExpectedNet,
    openFailNet: openNet - openExpectedNet,
    uploadedNet,
    uploadedExpectedNet,
    uploadedFailNet: uploadedNet - uploadedExpectedNet,
    deliveredNet,
    netRevenue,
    cogs,
    deliveredCogs,
    adSpendUsd,
    adSpend,
    cml,
    settledCml,
    expectedCml: cml - settledCml,
    cmlPct: ratio(cml, netRevenue),
    cogsPct: ratio(cogs, netRevenue),
    adPct: ratio(adSpend, netRevenue),
    fees,
    withoutProductsNet,
    open: [...openBy.values()].sort((a, b) => b.open - a.open),
    products: productList,
    unmapped: unmappedList,
    adsNotMapped: adsNotMapped.sort((a, b) => b.spend - a.spend),
    adsNotMappedSpend,
    bridge: null,
    bridgeUnavailable: null,
  };
  const bridge = complete ? planBridge(result, products, version, plan, days) : null;
  if (!complete) result.bridgeUnavailable = "incomplete";
  else if (typeof bridge === "string") result.bridgeUnavailable = bridge;
  else result.bridge = bridge;
  return result;
}

/**
 * Plan → actual, by sequential substitution over the MAPPED offers (each step
 * holds the earlier ones at actual and the later ones at plan, so the steps
 * add up to the gap exactly):
 *
 *   plan     Σ P·d·(n − c) − A_plan            P placed, d delivery, n net, c COGS per delivered
 *   volume   (k − 1)·Σ P·d·(n − c)             k = actual mapped placed ÷ plan placed
 *   mix      Σ Q·d·(n − c) − k·Σ P·d·(n − c)   Q actual placed per offer
 *   delivery Σ (D − Q·d)·(n − c)               D actual delivered-equivalent
 *   price    Σ (N − D·n)                       N actual revenue
 *   cogs     −Σ (C − D·c)                      C actual COGS
 *   ads      −(A_actual − A_plan)
 *   notInPlan  everything the plan has no line for: fees, orders without
 *            products, unmapped SKUs, lines with no offer
 */
function planBridge(
  r: ActualResult,
  products: readonly Product[],
  version: VersionData,
  plan: Plan | null,
  days: number,
): BridgeStep[] | "no-plan" | "no-mapped-orders" {
  if (!plan || !(plan.ordersPerDay > 0)) return "no-plan";
  const lines = planLines(plan, products, version.settings);
  const evaluated = new Map<string, OfferResult>();
  const offerOf = new Map<string, { product: Product; offer: Offer }>();
  for (const p of products)
    for (const o of p.offers) {
      evaluated.set(o.id, evaluateOffer(p, o, version.settings));
      offerOf.set(o.id, { product: p, offer: o });
    }

  let base = 0;
  let planPlaced = 0;
  let planAds = 0;
  for (const l of lines) {
    const P = l.orders * days;
    planPlaced += P;
    base += P * l.r.deliveryRate * (l.r.netRevenue - l.r.cogs);
    planAds += P * l.r.adSpend;
  }
  if (!(planPlaced > 0)) return "no-plan";

  let actualPlaced = 0;
  let mixAt = 0;
  let delivery = 0;
  let price = 0;
  let cogsStep = 0;
  let mappedCml = 0;
  for (const p of r.products)
    for (const o of p.offers) {
      if (!o.offerId) continue;
      const e = evaluated.get(o.offerId);
      if (!e) continue;
      const unit = e.netRevenue - e.cogs;
      actualPlaced += o.placed;
      mixAt += o.placed * e.deliveryRate * unit;
      delivery += (o.delivered - o.placed * e.deliveryRate) * unit;
      price += o.revenue - o.delivered * e.netRevenue;
      cogsStep -= o.cogs - o.delivered * e.cogs;
      mappedCml += o.revenue - o.cogs;
    }
  if (!(actualPlaced > 0)) return "no-mapped-orders";
  const k = actualPlaced / planPlaced;
  const planCml = base - planAds;
  const notInPlan = r.cml + r.adSpend - mappedCml;
  return [
    { key: "plan", value: planCml },
    { key: "volume", value: (k - 1) * base },
    { key: "mix", value: mixAt - k * base },
    { key: "delivery", value: delivery },
    { key: "price", value: price },
    { key: "cogs", value: cogsStep },
    { key: "ads", value: -(r.adSpend - planAds) },
    { key: "notInPlan", value: notInPlan },
    { key: "actual", value: r.cml },
  ];
}
