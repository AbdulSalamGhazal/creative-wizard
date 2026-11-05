/**
 * The Price Structure data model (brief §4). Pure types, no I/O.
 *
 * Units: percentages are FRACTIONS (0.15 = 15%); money is SAR unless the field
 * name ends in `Usd`. Full precision is kept in storage and in every
 * calculation — rounding happens only in the formatters (`../format.ts`).
 *
 * The internal metric keys `profit` / `margin` / `profitPerUnit` /
 * `monthlyProfit` mean CML / CML % / CML per unit / monthly CML. They stay as
 * they are so the old standalone tool's exports import unchanged (§9.3); the
 * UI always shows the CML labels from `METRICS` (metrics.ts).
 */

export interface Settings {
  /** Default 0.15. */
  vatRate: number;
  /** Default true: product prices are entered incl. VAT. */
  pricesIncludeVat: boolean;
  /** Default 3.75. */
  usdToSar: number;
  /** Share of placed orders that get delivered, 0.01–1. Default 0.85. */
  deliveryRate: number;
  /** SAR lost per undelivered order (shipping out + back, handling). Default 0. */
  undeliveredCost: number;
}

export type Mechanic =
  | { kind: "percent"; qty: number; pct: number }
  | { kind: "amount"; qty: number; amount: number }
  | { kind: "bxgy"; buy: number; get: number }
  | { kind: "bxgy_pct"; buy: number; get: number; pct: number }
  | { kind: "bundle"; qty: number; price: number };

export type MechanicKind = Mechanic["kind"];

export type AdMode = "cpa" | "roas";

export interface Offer {
  id: string;
  name: string;
  mechanic: Mechanic;
  /** Extra general discount on top of the mechanic, 0–1. */
  couponDiscount: number;
  /** Which ad-cost input is used. */
  adMode: AdMode;
  /** Ad spend per PLACED order in USD (adMode = 'cpa'), ≥ 0. */
  cpaUsd: number;
  /** Platform ROAS (adMode = 'roas'), ≥ 0.01. */
  platformRoas: number;
  /** null = use settings.deliveryRate. */
  deliveryRateOverride: number | null;
  /** Optional placed orders/month, integer ≥ 0 (Overview monthly tiles). */
  ordersPerMonth: number;
  notes: string;
}

export interface Product {
  id: string;
  name: string;
  /** Optional. */
  sku: string;
  /** SAR, ≥ 0. */
  unitCost: number;
  /** SAR list price of ONE unit, ≥ 0 (incl. VAT when pricesIncludeVat). */
  price: number;
  /** 0–7, index into the 8-colour categorical palette. */
  colorSlot: number;
  /** Order matters: shown in this order on every page. */
  offers: Offer[];
  notes: string;
}

export const METRIC_KEYS = [
  "profit",
  "margin",
  "profitPerUnit",
  "accountantRoas",
  "platformRoas",
  "adCostPct",
  "netRevenue",
  "cogsPct",
  "monthlyProfit",
  "monthlyRevenue",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface Target {
  id: string;
  metric: MetricKey;
  /** Minimum acceptable. */
  a: number;
  /** Stretch goal. */
  b: number;
  enabled: boolean;
}

export interface Plan {
  id: string;
  name: string;
  /** Placed orders per day, ≥ 0. */
  ordersPerDay: number;
  /** Share of orders per product (fractions; normalised when used). */
  productShare: Record<string, number>;
  /** Share of the product's orders per offer (normalised within product). */
  offerShare: Record<string, number>;
}

export interface ActualPeriod {
  id: string;
  /** "October 2026" */
  name: string;
  /** Integer ≥ 1. */
  days: number;
  /** Total ad spend for the whole period, ≥ 0. */
  adSpendUsd: number;
  /** ROAS Meta reported, for reference only. */
  metaRoas: number | null;
  /** Real delivery rate for the period; null = use settings. */
  deliveryRate: number | null;
  /** Placed orders per offer for the whole period, keyed `${productId}:${offerId}`. */
  orders: Record<string, number>;
}

export interface VersionData {
  settings: Settings;
  /** Order matters (display order). */
  products: Product[];
  targets: Target[];
  /** Which CML target drives "ROAS for A / B"; '' = default (see targets.ts). */
  roasTargetId: string;
  /** At least one. */
  plans: Plan[];
  activePlanId: string;
  actuals: ActualPeriod[];
}

/** The key an actual period stores an offer's orders under. */
export function orderKey(productId: string, offerId: string): string {
  return `${productId}:${offerId}`;
}

export const DEFAULT_SETTINGS: Settings = {
  vatRate: 0.15,
  pricesIncludeVat: true,
  usdToSar: 3.75,
  deliveryRate: 0.85,
  undeliveredCost: 0,
};

/** The three target levels a status can land on. Ordered worst → best. */
export type Status = "miss" | "a" | "b";
