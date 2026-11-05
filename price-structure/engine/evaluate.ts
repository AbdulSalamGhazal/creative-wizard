import { applyMechanic } from "./mechanics";
import type { Offer, Product, Settings } from "./types";

/**
 * Evaluating ONE offer, per order (brief §5.2). Money is SAR per DELIVERED
 * order unless the name says otherwise (`adSpend` is per PLACED order — ads
 * are paid for every order the customer submits, delivered or not).
 */

/** Goal-seek overrides: each one replaces the input it names. */
export interface Overrides {
  price?: number;
  unitCost?: number;
  cpaUsd?: number;
  platformRoas?: number;
  addDiscount?: number;
  deliveryRate?: number;
}

export interface OfferResult {
  units: number;
  /** List price of the units in the order, before discounts. */
  listPrice: number;
  /** "Customer pays": incl. VAT, after all discounts. */
  paidGross: number;
  /** Customer pays minus VAT. */
  netRevenue: number;
  vat: number;
  /** list − paid, in SAR. */
  discountValue: number;
  /** "Effective discount": discountValue ÷ list (0 when list is 0). */
  discount: number;
  cogs: number;
  /** SAR per PLACED order. */
  adSpend: number;
  deliveryRate: number;
  /** Ad spend carried by each delivered order: adSpend ÷ deliveryRate. */
  marketing: number;
  /** Undelivered-order cost carried by each delivered order. */
  undelivered: number;
  /** netRevenue − cogs − undelivered: what is left before ads. */
  contribution: number;
  /** CML (Clean Money Left): contribution − marketing. */
  profit: number;
  /** CML %: profit ÷ netRevenue. */
  margin: number;
  /** CML per unit. */
  profitPerUnit: number;
  cogsPct: number;
  marketingPct: number;
  undeliveredPct: number;
  cpaUsd: number;
  platformRoas: number;
  accountantRoas: number;
  /** (marketing + undelivered) ÷ netRevenue = 1 ÷ accountantRoas. */
  adCostPct: number;
  monthly: {
    placed: number;
    delivered: number;
    units: number;
    revenue: number;
    adSpend: number;
    /** "Monthly CML". */
    profit: number;
  };
}

/**
 * x ÷ 0 = 0 when x = 0, +∞ when x > 0, −∞ when x < 0 (brief §5.2). Infinite
 * values display as "—"; they never become NaN or throw.
 */
export function safeDiv(x: number, y: number): number {
  if (y === 0) return x === 0 ? 0 : x > 0 ? Infinity : -Infinity;
  return x / y;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function evaluateOffer(
  product: Product,
  offer: Offer,
  settings: Settings,
  ov: Overrides = {},
): OfferResult {
  const unitPrice = ov.price ?? product.price;
  const unitCost = ov.unitCost ?? product.unitCost;
  const s = product.price > 0 ? unitPrice / product.price : 1;
  const mech = applyMechanic(offer.mechanic, unitPrice, s);
  const paid = mech.paid * (1 - offer.couponDiscount) * (1 - (ov.addDiscount ?? 0));

  const vatMul = 1 + settings.vatRate;
  const paidGross = settings.pricesIncludeVat ? paid : paid * vatMul;
  const netRevenue = settings.pricesIncludeVat ? paid / vatMul : paid;
  const vat = paidGross - netRevenue;
  const discountValue = mech.list - paid;
  const discount = mech.list > 0 ? discountValue / mech.list : 0;
  const units = mech.units;
  const cogs = units * unitCost;

  let adSpend: number;
  if (ov.cpaUsd !== undefined) adSpend = ov.cpaUsd * settings.usdToSar;
  else if (ov.platformRoas !== undefined) adSpend = safeDiv(paidGross, ov.platformRoas);
  else if (offer.adMode === "cpa") adSpend = offer.cpaUsd * settings.usdToSar;
  else adSpend = safeDiv(paidGross, offer.platformRoas);

  const deliveryRate = clamp(
    ov.deliveryRate ?? offer.deliveryRateOverride ?? settings.deliveryRate,
    0.01,
    1,
  );
  const marketing = adSpend / deliveryRate;
  const undelivered = ((1 - deliveryRate) / deliveryRate) * settings.undeliveredCost;
  const contribution = netRevenue - cogs - undelivered;
  const profit = contribution - marketing;

  const placed = offer.ordersPerMonth;
  const delivered = placed * deliveryRate;

  return {
    units,
    listPrice: mech.list,
    paidGross,
    netRevenue,
    vat,
    discountValue,
    discount,
    cogs,
    adSpend,
    deliveryRate,
    marketing,
    undelivered,
    contribution,
    profit,
    margin: safeDiv(profit, netRevenue),
    profitPerUnit: units > 0 ? profit / units : 0,
    cogsPct: safeDiv(cogs, netRevenue),
    marketingPct: safeDiv(marketing, netRevenue),
    undeliveredPct: safeDiv(undelivered, netRevenue),
    cpaUsd: adSpend / settings.usdToSar,
    platformRoas: safeDiv(paidGross, adSpend),
    accountantRoas: safeDiv(netRevenue, marketing + undelivered),
    adCostPct: safeDiv(marketing + undelivered, netRevenue),
    monthly: {
      placed,
      delivered,
      units: delivered * units,
      revenue: delivered * netRevenue,
      adSpend: placed * adSpend,
      profit: delivered * profit,
    },
  };
}
