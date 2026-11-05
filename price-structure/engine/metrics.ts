import type { OfferResult } from "./evaluate";
import type { MetricKey, Status, Target } from "./types";
import { METRIC_KEYS } from "./types";

/** The unit a metric is shown in. */
export type MetricUnit = "sar" | "pct" | "x" | "usd";

export interface MetricMeta {
  key: MetricKey;
  label: string;
  short: string;
  unit: MetricUnit;
  higherIsBetter: boolean;
  /** The tooltip. */
  description: string;
  /** The two monthly metrics only mean something when there is monthly volume. */
  monthly: boolean;
}

/** The metrics catalogue (brief §5.5). Labels are what the UI shows. */
export const METRICS: Record<MetricKey, MetricMeta> = {
  profit: {
    key: "profit",
    label: "CML per order",
    short: "CML / order",
    unit: "sar",
    higherIsBetter: true,
    description:
      "Clean Money Left: SAR left from each delivered order after COGS and marketing.",
    monthly: false,
  },
  margin: {
    key: "margin",
    label: "CML % of revenue",
    short: "CML %",
    unit: "pct",
    higherIsBetter: true,
    description: "CML ÷ net revenue (ex VAT, after discounts).",
    monthly: false,
  },
  profitPerUnit: {
    key: "profitPerUnit",
    label: "CML per unit",
    short: "CML / unit",
    unit: "sar",
    higherIsBetter: true,
    description:
      "CML per delivered order ÷ units in the order. Fair way to compare bundles.",
    monthly: false,
  },
  accountantRoas: {
    key: "accountantRoas",
    label: "Accountant ROAS",
    short: "Acct. ROAS",
    unit: "x",
    higherIsBetter: true,
    description:
      "Net revenue (ex VAT, delivered only) ÷ (all ad spend + undelivered cost).",
    monthly: false,
  },
  platformRoas: {
    key: "platformRoas",
    label: "Platform ROAS",
    short: "Platform ROAS",
    unit: "x",
    higherIsBetter: true,
    description:
      "What the ad platform shows: order value incl. VAT ÷ ad spend per placed order.",
    monthly: false,
  },
  adCostPct: {
    key: "adCostPct",
    label: "Ad cost % of revenue",
    short: "Ad cost %",
    unit: "pct",
    higherIsBetter: false,
    description:
      "1 ÷ accountant ROAS. Share of net revenue spent on ads and undelivered orders.",
    monthly: false,
  },
  netRevenue: {
    key: "netRevenue",
    label: "Net revenue per order",
    short: "Net revenue",
    unit: "sar",
    higherIsBetter: true,
    description: "What the customer pays, minus VAT.",
    monthly: false,
  },
  cogsPct: {
    key: "cogsPct",
    label: "COGS % of revenue",
    short: "COGS %",
    unit: "pct",
    higherIsBetter: false,
    description: "Product cost ÷ net revenue.",
    monthly: false,
  },
  monthlyProfit: {
    key: "monthlyProfit",
    label: "Monthly CML",
    short: "Monthly CML",
    unit: "sar",
    higherIsBetter: true,
    description: "CML per delivered order × delivered orders per month.",
    monthly: true,
  },
  monthlyRevenue: {
    key: "monthlyRevenue",
    label: "Monthly net revenue",
    short: "Monthly revenue",
    unit: "sar",
    higherIsBetter: true,
    description: "Net revenue × delivered orders per month.",
    monthly: true,
  },
};

/** The catalogue in display order. */
export const METRIC_LIST: readonly MetricMeta[] = METRIC_KEYS.map((k) => METRICS[k]);

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === "string" && (METRIC_KEYS as readonly string[]).includes(value);
}

/** Read one metric off an evaluated offer. */
export function metricValue(r: OfferResult, key: MetricKey): number {
  switch (key) {
    case "profit":
      return r.profit;
    case "margin":
      return r.margin;
    case "profitPerUnit":
      return r.profitPerUnit;
    case "accountantRoas":
      return r.accountantRoas;
    case "platformRoas":
      return r.platformRoas;
    case "adCostPct":
      return r.adCostPct;
    case "netRevenue":
      return r.netRevenue;
    case "cogsPct":
      return r.cogsPct;
    case "monthlyProfit":
      return r.monthly.profit;
    case "monthlyRevenue":
      return r.monthly.revenue;
  }
}

/** "Better than x" under the metric's direction (brief §5.6). */
export function meets(value: number, x: number, higherIsBetter: boolean): boolean {
  return higherIsBetter ? value >= x : value <= x;
}

/**
 * Status of a value against a target's A and B (brief §5.6). An infinite value
 * is B when it points the right way and Miss otherwise; NaN is Miss.
 */
export function statusOf(value: number, a: number, b: number, higherIsBetter: boolean): Status {
  if (Number.isNaN(value)) return "miss";
  if (!Number.isFinite(value)) {
    const goodInfinity = higherIsBetter ? value === Infinity : value === -Infinity;
    return goodInfinity ? "b" : "miss";
  }
  if (meets(value, b, higherIsBetter)) return "b";
  if (meets(value, a, higherIsBetter)) return "a";
  return "miss";
}

export function statusAgainst(r: OfferResult, target: Target): Status {
  const meta = METRICS[target.metric];
  return statusOf(metricValue(r, target.metric), target.a, target.b, meta.higherIsBetter);
}

const STATUS_RANK: Record<Status, number> = { miss: 0, a: 1, b: 2 };

/** The worse of two statuses (Miss < A < B). */
export function worstStatus(x: Status, y: Status): Status {
  return STATUS_RANK[x] <= STATUS_RANK[y] ? x : y;
}

/**
 * An offer's overall status: the worst status across all ENABLED targets;
 * null when no target is enabled.
 */
export function overallStatus(r: OfferResult, targets: readonly Target[]): Status | null {
  let out: Status | null = null;
  for (const t of targets) {
    if (!t.enabled) continue;
    const s = statusAgainst(r, t);
    out = out === null ? s : worstStatus(out, s);
  }
  return out;
}

/**
 * Sort key for "best first" rankings: higher-is-better metrics sort
 * descending, the others ascending; ±∞ land at the correct end and NaN sinks.
 */
export function rankCompare(key: MetricKey): (a: number, b: number) => number {
  const sign = METRICS[key].higherIsBetter ? -1 : 1;
  return (a, b) => {
    const an = Number.isNaN(a);
    const bn = Number.isNaN(b);
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (a === b) return 0;
    return (a < b ? -1 : 1) * sign;
  };
}
