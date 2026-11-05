import { evaluateOffer, type OfferResult, type Overrides } from "./evaluate";
import { meets, METRICS, metricValue } from "./metrics";
import type { MetricKey, Offer, Product, Settings } from "./types";

/**
 * Goal seek — "What it takes" (brief §5.7): the value of ONE lever that makes a
 * metric equal a target level, everything else unchanged.
 */
export type LeverKey = keyof Overrides;

export interface LeverMeta {
  key: LeverKey;
  label: string;
  unit: "sar" | "usd" | "x" | "pct";
}

export const LEVERS: readonly LeverMeta[] = [
  { key: "price", label: "Unit list price", unit: "sar" },
  { key: "cpaUsd", label: "CPA (ad cost per order)", unit: "usd" },
  { key: "platformRoas", label: "Platform ROAS", unit: "x" },
  { key: "addDiscount", label: "Extra discount on top", unit: "pct" },
  { key: "unitCost", label: "Unit cost", unit: "sar" },
  { key: "deliveryRate", label: "Delivery rate", unit: "pct" },
];

export const LEVER_META: Record<LeverKey, LeverMeta> = Object.fromEntries(
  LEVERS.map((l) => [l.key, l]),
) as Record<LeverKey, LeverMeta>;

/** The lever's "Now" value for an offer. */
export function leverNow(key: LeverKey, product: Product, r: OfferResult): number {
  switch (key) {
    case "price":
      return product.price;
    case "cpaUsd":
      return r.cpaUsd;
    case "platformRoas":
      return r.platformRoas;
    case "addDiscount":
      return 0;
    case "unitCost":
      return product.unitCost;
    case "deliveryRate":
      return r.deliveryRate;
  }
}

/** The search range of a lever for an offer. */
export function leverRange(key: LeverKey, product: Product, r: OfferResult): [number, number] {
  switch (key) {
    case "price":
      return [0.01, Math.max(product.price, 1) * 20];
    case "cpaUsd":
      return [0, Math.max(500, r.cpaUsd * 20)];
    case "platformRoas":
      return [0.05, 200];
    case "addDiscount":
      return [0, 0.99];
    case "unitCost":
      return [0, Math.max(product.price, product.unitCost, 1) * 10];
    case "deliveryRate":
      return [0.01, 1];
  }
}

export type GoalSeekResult =
  | {
      kind: "solved";
      value: number;
      /** 'gte' = the lever must be at least `value`; 'lte' = at most. */
      direction: "gte" | "lte";
      alreadyMet: boolean;
      now: number;
    }
  | { kind: "always"; now: number }
  | { kind: "unreachable"; now: number };

const ITERATIONS = 80;

export function goalSeek(
  product: Product,
  offer: Offer,
  settings: Settings,
  lever: LeverKey,
  metric: MetricKey,
  target: number,
): GoalSeekResult {
  const meta = METRICS[metric];
  const sign = meta.higherIsBetter ? 1 : -1;
  const base = evaluateOffer(product, offer, settings);
  const now = leverNow(lever, product, base);
  const g = (x: number) => sign * (metricValue(evaluateOffer(product, offer, settings, { [lever]: x }), metric) - target);

  const [lo, hi] = leverRange(lever, product, base);
  const gLo = g(lo);
  const gHi = g(hi);
  const alreadyMet = meets(metricValue(base, metric), target, meta.higherIsBetter);

  if (Number.isNaN(gLo) || Number.isNaN(gHi) || Math.sign(gLo) === Math.sign(gHi)) {
    return gLo >= 0 && gHi >= 0 ? { kind: "always", now } : { kind: "unreachable", now };
  }
  const direction: "gte" | "lte" = gHi >= gLo ? "gte" : "lte";
  let a = lo;
  let b = hi;
  let ga = gLo;
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (a + b) / 2;
    const gm = g(mid);
    if (Math.sign(gm) === Math.sign(ga)) {
      a = mid;
      ga = gm;
    } else {
      b = mid;
    }
  }
  return { kind: "solved", value: (a + b) / 2, direction, alreadyMet, now };
}
