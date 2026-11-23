import type { StoreFieldType } from "@/lib/enums";

/**
 * The order fields the Salla feed OWNS beyond utm_source / channel / status
 * (2026-11-23: "build columns for all data received from Salla"). Plain
 * module — the Orders table (client) reads the keys, the mapper fills them,
 * and migration 0078 seeds exactly these rows per connected brand (a test
 * pins the two lists together).
 *
 * Money is SAR (× the order's exchange rate), written as a number; a date is
 * the Riyadh day. `shown` = visible by default on Orders; the rest start
 * hidden and are one click away in the Columns menu.
 */
export interface FeedField {
  key: string;
  label: string;
  type: StoreFieldType;
  shown: boolean;
}

export const FEED_FIELDS = [
  { key: "payment_method", label: "Payment method", type: "text", shown: true },
  { key: "payment_type", label: "COD or prepaid", type: "text", shown: false },
  { key: "coupon_code", label: "Coupon code", type: "text", shown: true },
  { key: "coupon_discount", label: "Coupon discount (excl. VAT)", type: "number", shown: false },
  { key: "discount", label: "Discount (excl. VAT)", type: "number", shown: true },
  { key: "subtotal", label: "Subtotal (excl. VAT)", type: "number", shown: false },
  { key: "shipping_fee", label: "Shipping (excl. VAT)", type: "number", shown: false },
  { key: "cod_fee", label: "COD fee (excl. VAT)", type: "number", shown: false },
  { key: "vat", label: "VAT", type: "number", shown: false },
  { key: "city", label: "City", type: "text", shown: true },
  { key: "country", label: "Country", type: "text", shown: false },
  { key: "shipping_company", label: "Shipping company", type: "text", shown: false },
  { key: "tracking_number", label: "Tracking number", type: "text", shown: false },
  { key: "delivered_date", label: "Delivered", type: "date", shown: false },
  { key: "refund_amount", label: "Refund amount", type: "number", shown: false },
  { key: "tags", label: "Tags", type: "text", shown: false },
  { key: "utm_medium", label: "UTM medium", type: "text", shown: false },
  { key: "utm_campaign", label: "UTM campaign", type: "text", shown: false },
  { key: "utm_term", label: "UTM term", type: "text", shown: false },
  { key: "utm_content", label: "UTM content", type: "text", shown: false },
  { key: "salla_source", label: "Salla source", type: "text", shown: false },
  { key: "entry", label: "Entry", type: "text", shown: false },
  { key: "currency", label: "Currency", type: "text", shown: false },
  { key: "exchange_rate", label: "Exchange rate", type: "number", shown: false },
  { key: "salla_customer_id", label: "Salla customer ID", type: "text", shown: false },
] as const satisfies readonly FeedField[];

export type FeedFieldKey = (typeof FEED_FIELDS)[number]["key"];

export const FEED_FIELD_KEYS: readonly FeedFieldKey[] = FEED_FIELDS.map((f) => f.key);

/** The feed fields that start hidden on the Orders table. */
export const FEED_FIELDS_HIDDEN_BY_DEFAULT: readonly string[] = FEED_FIELDS.filter(
  (f) => !f.shown,
).map((f) => f.key);
