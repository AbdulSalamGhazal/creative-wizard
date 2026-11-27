/**
 * Pricing · Actual (2026-11-27) — the FACTS the actual-CML engine reads. The
 * query layer (`db/queries/price-structure-actual.ts`) fills them from the
 * Store's orders, Product costs and the Ads uploads; the engine
 * (`./engine.ts`) is pure and turns them into the page. Money is SAR before
 * VAT unless the name ends in `Usd` or `InclVat`.
 *
 * An order's money splits two ways, by construction (Salla's own identity,
 * verified on a real order 2026-11-27: total = sub_total − discount +
 * shipping + COD fee + tax, every part before VAT but the tax):
 *   net        = total − VAT
 *   productNet = sub_total − discount  (coupons + offers)
 *   feesNet    = net − productNet      (shipping + COD fee)
 * and productNet is spread over the order's lines in proportion to their
 * line totals — so every line, fee and order foots back to the store total.
 */

/**
 * Where an order stands: delivered · lost (cancelled, deleted, refunded) ·
 * open (any other Salla status) · uploaded (an order the feed never wrote:
 * no status at all, so nothing says whether it arrived).
 */
export type Outcome = "delivered" | "open" | "lost" | "uploaded";

export const OUTCOMES: readonly Outcome[] = ["delivered", "open", "lost", "uploaded"];

/** One group of order LINES: a SKU at one quantity, one outcome, one payment method. */
export interface LineFact {
  /** The Store's line key: the SKU, or the name when Salla sent none. */
  productKey: string;
  /** The line's product name, for display. */
  name: string | null;
  quantity: number;
  outcome: Outcome;
  paymentMethod: string;
  /** How many lines (one line = one "order of this offer"). */
  lines: number;
  units: number;
  /** The lines' share of their orders' product money, before VAT, after discounts. */
  revenue: number;
  /** Units × the cost in force on the order's day — costed lines only. */
  cogs: number;
  /** Units with no cost in force on their order's day. */
  uncostedUnits: number;
}

/** The orders of one outcome and payment method. */
export interface OrderFact {
  outcome: Outcome;
  paymentMethod: string;
  orders: number;
  totalInclVat: number;
  vat: number;
  /** total − VAT. */
  net: number;
  /** The product part of `net` on orders that carry lines. */
  productNet: number;
  /** Shipping and COD fees (before VAT) on orders that carry lines. */
  feesNet: number;
  /** Orders with no product lines (uploads): their whole `net` is unsplit. */
  ordersWithoutLines: number;
  netWithoutLines: number;
}

/** Closed orders of one payment method over the trailing window — its real delivery rate. */
export interface DeliveryRateFact {
  paymentMethod: string;
  delivered: number;
  lost: number;
}

/** Ad spend of one Library product over the range (raw, every platform). */
export interface AdSpendFact {
  productId: string;
  productName: string;
  spendUsd: number;
}

export interface ActualFacts {
  from: string;
  to: string;
  lines: LineFact[];
  orders: OrderFact[];
  rates: DeliveryRateFact[];
  /** The trailing window the rates were read over. */
  ratesFrom: string;
  ratesTo: string;
  adSpend: AdSpendFact[];
}

/** The per-brand mappings (`ps_sku_mappings`, `ps_sku_offer_mappings`, `ps_ad_product_mappings`). */
export interface ActualMappings {
  /** productKey → Pricing product id. */
  skuProduct: Record<string, string>;
  /** `${productKey}${KEY_SEP}${quantity}` → Pricing offer id. */
  skuOffer: Record<string, string>;
  /** Library product id → Pricing product id. */
  adProduct: Record<string, string>;
}

/** U+0001, the house composite-key separator (never U+0000 — CLAUDE.md traps). */
export const KEY_SEP = "\u0001";

export function skuOfferKey(productKey: string, quantity: number): string {
  return `${productKey}${KEY_SEP}${quantity}`;
}
