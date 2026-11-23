import { beforeVat } from "@/store/vat";

/** The fields of an order line the profit needs (a `StoreOrderItem`). */
export interface ProfitLine {
  quantity: number;
  /** Line total incl. VAT, SAR; null when unknown. */
  lineTotal: number | null;
  /** Unit cost in force on the order's date, SAR; null when none entered. */
  unitCost: number | null;
}

export interface OrderProfit {
  /** Lines that have a unit cost in force on the order's date. */
  costed: number;
  lines: number;
  /** Σ quantity × unit cost over the costed lines, SAR. */
  cost: number;
  /** Σ line totals before VAT − cost, over the costed lines; null when a line lacks a cost or a SAR total. */
  grossProfit: number | null;
}

/** An order's product cost and gross profit (sales before VAT − cost). Pure. */
export function orderProfit(items: ProfitLine[]): OrderProfit {
  let cost = 0;
  let salesBeforeVat = 0;
  let costed = 0;
  let complete = items.length > 0;
  for (const l of items) {
    if (l.unitCost === null || l.lineTotal === null) {
      complete = false;
      if (l.unitCost !== null) {
        costed++;
        cost += l.quantity * l.unitCost;
      }
      continue;
    }
    costed++;
    cost += l.quantity * l.unitCost;
    salesBeforeVat += beforeVat(l.lineTotal);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    costed,
    lines: items.length,
    cost: round(cost),
    grossProfit: complete ? round(salesBeforeVat - cost) : null,
  };
}

