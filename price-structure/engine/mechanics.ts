import type { Mechanic, MechanicKind } from "./types";

/**
 * Offer mechanics (brief §5.1): how many units an order carries, what they
 * list for before any discount, and what the customer pays before the coupon.
 *
 * `P` is the unit list price in play (the product's, or the goal-seek
 * override) and `s = P ÷ product.price` scales a bundle's fixed price with it
 * (1 unless goal seek changes the price).
 */
export interface MechanicResult {
  units: number;
  /** Before discount. */
  list: number;
  /** Before the coupon. */
  paid: number;
}

export function applyMechanic(m: Mechanic, unitPrice: number, s: number): MechanicResult {
  switch (m.kind) {
    case "percent": {
      const list = m.qty * unitPrice;
      return { units: m.qty, list, paid: list * (1 - m.pct) };
    }
    case "amount": {
      const list = m.qty * unitPrice;
      return { units: m.qty, list, paid: Math.max(0, list - m.amount) };
    }
    case "bxgy": {
      const units = m.buy + m.get;
      return { units, list: units * unitPrice, paid: m.buy * unitPrice };
    }
    case "bxgy_pct": {
      const units = m.buy + m.get;
      return {
        units,
        list: units * unitPrice,
        paid: m.buy * unitPrice + m.get * unitPrice * (1 - m.pct),
      };
    }
    case "bundle": {
      return { units: m.qty, list: m.qty * unitPrice, paid: m.price * s };
    }
  }
}

/** A percentage with at most one decimal: 0.15 → "15%", 0.125 → "12.5%". */
export function pctText(fraction: number): string {
  const v = Math.round(fraction * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** A SAR amount for mechanic text: whole numbers plain, else up to 2 decimals. */
function sarText(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded);
}

/** Human-readable mechanic text — the chip, and the line under offer names. */
export function mechanicText(m: Mechanic): string {
  switch (m.kind) {
    case "percent":
      if (m.pct === 0) return m.qty > 1 ? `${m.qty} units, full price` : "Full price";
      return m.qty > 1 ? `${pctText(m.pct)} off × ${m.qty} units` : `${pctText(m.pct)} off`;
    case "amount":
      return m.qty > 1
        ? `${sarText(m.amount)} SAR off × ${m.qty} units`
        : `${sarText(m.amount)} SAR off`;
    case "bxgy":
      return `Buy ${m.buy} get ${m.get} free`;
    case "bxgy_pct":
      return `Buy ${m.buy} get ${m.get} at ${pctText(m.pct)} off`;
    case "bundle":
      return `${m.qty} units for ${sarText(m.price)} SAR`;
  }
}

export const MECHANIC_KINDS: readonly MechanicKind[] = [
  "percent",
  "amount",
  "bxgy",
  "bxgy_pct",
  "bundle",
];

/** The "Offer type" select's labels (brief §6.2). */
export const MECHANIC_KIND_LABEL: Record<MechanicKind, string> = {
  percent: "% off",
  amount: "Amount off (SAR)",
  bxgy: "Buy X get Y free",
  bxgy_pct: "Buy X get Y at % off",
  bundle: "Bundle at fixed price",
};

/**
 * Switch an offer's type keeping sensible values (brief §6.2): quantities,
 * buy/get and percentages carry over where they mean the same thing; a new
 * bundle price starts at 80% of list; an amount starts at 10% of a unit.
 */
export function convertMechanic(from: Mechanic, to: MechanicKind, unitPrice: number): Mechanic {
  if (from.kind === to) return from;
  const qty = "qty" in from ? from.qty : from.buy + from.get;
  const pct = "pct" in from ? from.pct : null;
  const buy = "buy" in from ? from.buy : null;
  const get = "get" in from ? from.get : null;
  switch (to) {
    case "percent":
      return { kind: "percent", qty, pct: pct ?? 0.1 };
    case "amount":
      return { kind: "amount", qty, amount: Math.round(unitPrice * 0.1) };
    case "bxgy":
      return { kind: "bxgy", buy: buy ?? 2, get: get ?? 1 };
    case "bxgy_pct":
      return { kind: "bxgy_pct", buy: buy ?? 1, get: get ?? 1, pct: pct ?? 0.5 };
    case "bundle": {
      const units = Math.max(2, qty);
      return { kind: "bundle", qty: units, price: Math.round(unitPrice * units * 0.8) };
    }
  }
}
