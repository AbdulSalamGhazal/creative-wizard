import type { StoreField } from "@/store/fields";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { CHANNEL_LABEL, CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL } from "@/store/channels";
import { PLATFORM_LABEL } from "@/lib/palette";
import { UNATTRIBUTED } from "@/store/sources";

/**
 * Store Insights — the pure half (no React, no SQL), so the dimension list,
 * the top-N fold and the share/AOV math are unit-testable.
 *
 * STANDING DECISION (2026-09, user): this page is STORE FACTS ONLY, in SAR
 * ONLY — no spend, no ROAS, no platform-claimed conversions, ever.
 * Reconciliation owns claimed-vs-store; Budget owns money plans. A number here
 * comes from `store_orders` and nothing else.
 */

/** The two MAPPED lenses — not fields, so they can't collide with a field key. */
export const PLATFORM_LENS = "lens:platform";
export const CHANNEL_LENS = "lens:channel";

/** Values past this many are folded into one "Other" row for DISPLAY. */
export const TOP_VALUE_LIMIT = 40;

export interface InsightDimension {
  /** URL value (`?by=`): a field key, or one of the two lens sentinels. */
  key: string;
  label: string;
  kind: "field" | "lens";
}

/**
 * Fields "Break down by" never offers (user decision 2026-11-27: "plotting the
 * phone numbers is obviously not relevant"). Two reasons, one list:
 * PERSONAL data (name, phone, email — the keys the feed fills and uploads
 * share, `CONNECTOR_CUSTOMER_KEYS`; a unit test ties the two) is never put on
 * a chart, and an ID-like value (a tracking number, Salla's customer id) is
 * one bucket per order or customer — a list of rows, not a breakdown.
 */
export const BREAKDOWN_EXCLUDED_KEYS: readonly string[] = [
  "customer_name",
  "phone",
  "email",
  "tracking_number",
  "salla_customer_id",
];
const EXCLUDED_SET: ReadonlySet<string> = new Set(BREAKDOWN_EXCLUDED_KEYS);

/**
 * Whether a field makes a breakdown: TEXT fields only (a number is a measure
 * — a discount, a fee, a rate — and a date is the trend), and none of the
 * excluded keys above.
 */
export function isGroupable(f: Pick<StoreField, "key" | "type">): boolean {
  return f.type === "text" && !EXCLUDED_SET.has(f.key);
}

/**
 * What a brand can analyze by: its own configured fields, then the two mapped
 * lenses. DERIVED from the field config — never hand-listed, so a field added
 * in Order fields shows up here with its configured label and nothing else has
 * to change.
 *
 * The three CORE fields are excluded on purpose: `order_id` is unique per row
 * (one order per bucket is not a breakdown), `order_date` IS the trend above,
 * and `total_amount` is the measure, not a dimension.
 *
 * Order: system-required first (UTM source, Channel), then the account's own
 * custom fields by `sort_order`, then the lenses — the raw value first, its
 * mapped reading second, because that is how you read them.
 */
export function insightDimensions(fields: readonly StoreField[]): InsightDimension[] {
  const usable = fields.filter((f) => !f.core && isGroupable(f));
  const ordered = [
    ...usable.filter((f) => f.systemRequired),
    ...usable.filter((f) => !f.systemRequired),
  ];
  return [
    ...ordered.map((f): InsightDimension => ({ key: f.key, label: f.label, kind: "field" })),
    { key: PLATFORM_LENS, label: "Platform (via UTM mapping)", kind: "lens" },
    { key: CHANNEL_LENS, label: "Channel (Website / Application)", kind: "lens" },
  ];
}

/**
 * The dimension a URL asks for, or the default. A `?by=` naming a field that
 * has since been DELETED (or a value nobody ever offered) falls back rather
 * than 500s or scans a column that doesn't exist — the stale-cookie discipline.
 */
export function resolveDimension(
  by: string | undefined,
  dimensions: readonly InsightDimension[],
): InsightDimension | null {
  if (dimensions.length === 0) return null;
  const asked = by ? dimensions.find((d) => d.key === by) : undefined;
  if (asked) return asked;
  return dimensions.find((d) => d.key === STORE_SOURCE_FIELD_KEY) ?? dimensions[0]!;
}

/** Average order value — NULL (a dash) at zero orders, never a divide-by-zero. */
export function aov(revenue: number, orders: number): number | null {
  return orders > 0 ? revenue / orders : null;
}

/** A value's share of the range total — NULL when the total is 0. */
export function share(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

export interface BreakdownValue {
  /** The raw value, or NULL for the explicit blank bucket. */
  value: string | null;
  orders: number;
  revenue: number;
  /** The group's first / last order date (YYYY-MM-DD) — MIN/MAX of the same GROUP BY. */
  firstOrder?: string | null;
  lastOrder?: string | null;
}

export interface FoldedRow extends BreakdownValue {
  /** How many values this row stands for — > 1 only for the "Other" fold. */
  foldedCount: number;
}

/** The sentinel value of the folded row (never a real field value: `->>` can't yield it). */
export const OTHER_VALUE = "__other__";

/**
 * Top-N by ORDERS, with the tail folded into ONE "Other" row so the table
 * stays readable on a long-tail dimension (UTM sources are famously long-tail).
 * The fold is by orders regardless of how the table is currently sorted, and
 * it PRESERVES the totals — Other carries the tail's orders and revenue, so
 * the column sums still reconcile with the range.
 */
export function foldTopValues(
  rows: readonly BreakdownValue[],
  limit = TOP_VALUE_LIMIT,
  /**
   * The RANGE's totals and its honest distinct-value count. The breakdown
   * query stops at BREAKDOWN_GROUP_CAP groups, so past it the returned rows
   * no longer sum to the range — Other is then the range total MINUS what is
   * shown, never just the returned tail (W1-11, audit B-16: 1,200 values read
   * as 1,000 orders beside a 1,200-order total).
   */
  range?: { orders: number; revenue: number; values: number },
): FoldedRow[] {
  const byOrders = [...rows].sort(
    (a, b) => b.orders - a.orders || b.revenue - a.revenue,
  );
  const values = Math.max(range?.values ?? 0, byOrders.length);
  if (values <= limit) {
    return byOrders.map((r) => ({ ...r, foldedCount: 1 }));
  }
  const head = byOrders.slice(0, limit).map((r) => ({ ...r, foldedCount: 1 }));
  const tail = byOrders.slice(limit);
  const shownOrders = head.reduce((a, r) => a + r.orders, 0);
  const shownRevenue = head.reduce((a, r) => a + r.revenue, 0);
  // Other's first/last order is the tail's — only when the tail is ALL of it
  // (past the query's group cap the unreturned values' dates are unknown).
  const tailComplete = byOrders.length >= values;
  const dates = (pick: (r: BreakdownValue) => string | null | undefined) =>
    tail.map(pick).filter((d): d is string => typeof d === "string").sort();
  const firsts = tailComplete ? dates((r) => r.firstOrder) : [];
  const lasts = tailComplete ? dates((r) => r.lastOrder) : [];
  return [
    ...head,
    {
      value: OTHER_VALUE,
      orders: range
        ? Math.max(0, range.orders - shownOrders)
        : tail.reduce((a, r) => a + r.orders, 0),
      revenue: range
        ? Math.max(0, Math.round((range.revenue - shownRevenue) * 100) / 100)
        : tail.reduce((a, r) => a + r.revenue, 0),
      foldedCount: values - head.length,
      firstOrder: firsts[0] ?? null,
      lastOrder: lasts.at(-1) ?? null,
    },
  ];
}

/**
 * How a bucket reads in the table. A BLANK value is its own explicit bucket
 * named after the field ("No UTM source") — never dropped, never merged into a
 * neighbour, because "we don't know" is an answer and it has to keep the
 * column sums honest. The two lenses reuse Reconciliation's own vocabulary and
 * sentinels so the same order lands in the same bucket on both pages.
 */
/**
 * A dimension's label inside a sentence ("No …", "no … values"): first letter
 * lowered, UNLESS the label opens with an acronym — "UTM source" must not
 * become "utm source", while "Coupon code" should become "coupon code".
 */
export function dimensionNoun(label: string): string {
  if (/^[A-Z]{2,}/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

export function valueLabel(
  value: string | null,
  dimension: InsightDimension,
  foldedCount = 1,
): string {
  if (value === OTHER_VALUE) {
    return `Other (${foldedCount} value${foldedCount === 1 ? "" : "s"})`;
  }
  if (value === null) return `No ${dimensionNoun(dimension.label)}`;
  if (dimension.key === PLATFORM_LENS) {
    return value === UNATTRIBUTED
      ? "Unattributed"
      : (PLATFORM_LABEL[value as keyof typeof PLATFORM_LABEL] ?? value);
  }
  if (dimension.key === CHANNEL_LENS) {
    return value === UNMAPPED_CHANNEL
      ? "Unmapped"
      : (CHANNEL_LABEL[value as (typeof CHANNEL_DESTINATIONS)[number]] ?? value);
  }
  return value;
}

// ── The decision sections (2026-11-27) ───────────────────────────────────────
//
// Six fixed lenses over the order's own fields, each answering one question a
// marketer asks of the orders: how they pay, where they end up, where they
// live, which promo they used, which offer, who ships it. They are READ from
// the feed's owned keys (`store/feed-fields.ts`); an uploaded order without
// the key lands in the explicit "Not reported" bucket, never dropped.

export const SECTION_LENSES = {
  payment: "payment_method",
  status: "order_status",
  city: "city",
  coupon: "coupon_code",
  offer: "offers",
  shipping: "shipping_company",
} as const;
export type SectionLens = keyof typeof SECTION_LENSES;
export const SECTION_LENS_KEYS = Object.keys(SECTION_LENSES) as SectionLens[];

/** Rows a section shows before the rest fold into "Other". */
export const SECTION_TOP = 8;

export interface LensValue {
  value: string | null;
  orders: number;
  revenue: number;
  /** Cancelled, deleted or refunded — `orderStatusTone` neg/warn. */
  lost: number;
  couponDiscount: number;
  offerDiscount: number;
  /** Orders with a delivered day, and the sum of their days to deliver. */
  delivered: number;
  deliveryDays: number;
}

export type LensSums = Omit<LensValue, "value">;

export interface SectionRow extends LensValue {
  /** > 1 only for the folded "Other" row. */
  foldedCount: number;
}

const SUM_KEYS: ReadonlyArray<keyof LensSums> = [
  "orders",
  "revenue",
  "lost",
  "couponDiscount",
  "offerDiscount",
  "delivered",
  "deliveryDays",
];

/**
 * Top-N by orders with the tail folded into ONE "Other" row that carries the
 * tail's every sum, so a section's rows always add up to the range — the same
 * contract as `foldTopValues`. `total` is the range's own totals (the query
 * caps each lens's values, so the tail is the total minus what is shown).
 * The blank bucket is shown whatever its size: "not reported" is an answer
 * about the data, and folding it into Other would hide the gap.
 */
export function foldSection(
  rows: readonly LensValue[],
  total: LensSums,
  limit = SECTION_TOP,
): SectionRow[] {
  const sorted = [...rows].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
  const blank = sorted.find((r) => r.value === null);
  const named = sorted.filter((r) => r.value !== null);
  const head = named.slice(0, limit);
  const shown = blank ? [...head, blank] : head;
  const out: SectionRow[] = shown.map((r) => ({ ...r, foldedCount: 1 }));
  const restCount = named.length - head.length;
  const rest = Object.fromEntries(
    SUM_KEYS.map((k) => [
      k,
      Math.max(0, Math.round((total[k] - shown.reduce((a, r) => a + r[k], 0)) * 100) / 100),
    ]),
  ) as unknown as LensSums;
  if (restCount > 0 || rest.orders > 0) {
    // Past the query's cap a value we never saw is still a value: Other then
    // stands for at least one.
    out.push({ value: OTHER_VALUE, ...rest, foldedCount: Math.max(1, restCount) });
  }
  return out;
}

/** A count's share — NULL (a dash) when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Average days to deliver — NULL when no order in the bucket was delivered. */
export function avgDeliveryDays(r: Pick<LensValue, "delivered" | "deliveryDays">): number | null {
  return r.delivered > 0 ? r.deliveryDays / r.delivered : null;
}

export interface ProductTotals {
  /** Units sold, every order counts. */
  units: number;
  /** Line totals incl. VAT, SAR. */
  sales: number;
  /** Line totals of the COSTED lines, BEFORE VAT. */
  costedSalesExVat: number;
  cogs: number;
  unitsWithoutCost: number;
  /** Salla sale-price markdown, excl. VAT. */
  markdown: number;
}

/**
 * Gross profit and margin over the COSTED lines only (store.md: a line with
 * no cost is never guessed). NULL when no line in the set has a cost.
 */
export function grossProfit(t: Pick<ProductTotals, "costedSalesExVat" | "cogs">): {
  profit: number | null;
  margin: number | null;
} {
  if (t.costedSalesExVat <= 0) return { profit: null, margin: null };
  const profit = Math.round((t.costedSalesExVat - t.cogs) * 100) / 100;
  return { profit, margin: profit / t.costedSalesExVat };
}
