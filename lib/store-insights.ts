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
  const usable = fields.filter((f) => !f.core);
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
): FoldedRow[] {
  const byOrders = [...rows].sort(
    (a, b) => b.orders - a.orders || b.revenue - a.revenue,
  );
  if (byOrders.length <= limit) {
    return byOrders.map((r) => ({ ...r, foldedCount: 1 }));
  }
  const head = byOrders.slice(0, limit).map((r) => ({ ...r, foldedCount: 1 }));
  const tail = byOrders.slice(limit);
  return [
    ...head,
    {
      value: OTHER_VALUE,
      orders: tail.reduce((a, r) => a + r.orders, 0),
      revenue: tail.reduce((a, r) => a + r.revenue, 0),
      foldedCount: tail.length,
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
