import { SAUDI_VAT_RATE } from "@/store/vat";

/**
 * Salla sale prices (2026-11-23, "350 → 299" per item). The connector sends
 * each line's unit price and the product's regular price, both EXCL. VAT;
 * the order panel shows lines INCL. VAT, so the regular price is shown with
 * VAT. Plain module — the panel (client) reads it.
 */
export interface SaleLine {
  quantity: number;
  /** The line incl. VAT, SAR. */
  lineTotal: number | null;
  /** Per unit, excl. VAT, SAR. */
  unitPrice: number | null;
  originalUnitPrice: number | null;
}

/** The line's markdown, excl. VAT, SAR — 0 when not on sale or not known. */
export function lineSaleDiscount(l: SaleLine): number {
  if (l.unitPrice === null || l.originalUnitPrice === null) return 0;
  const per = l.originalUnitPrice - l.unitPrice;
  return per > 0 ? Math.round(per * l.quantity * 100) / 100 : 0;
}

/**
 * What the line would have cost at the regular price, incl. VAT, SAR — or
 * null when it was not on sale (or the figures aren't known). The unit price
 * is rounded incl. VAT first, as the store lists it: 304.35 excl. → 350.00,
 * so two units read 700.00, never 700.01.
 */
export function regularLineTotal(l: SaleLine): number | null {
  if (lineSaleDiscount(l) === 0 || l.lineTotal === null || l.originalUnitPrice === null) return null;
  const unit = Math.round(l.originalUnitPrice * (1 + SAUDI_VAT_RATE) * 100) / 100;
  return Math.round(unit * l.quantity * 100) / 100;
}
