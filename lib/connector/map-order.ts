import { parseStoreDate } from "@/store/parse";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { STORE_CHANNEL_FIELD_KEY } from "@/store/channels";
import { ORDER_STATUS_FIELD_KEY } from "@/store/order-status";
import { FEED_FIELD_KEYS, type FeedFieldKey } from "@/store/feed-fields";
import {
  connectorCouponSchema,
  connectorOfferSchema,
  connectorItemSchema,
  connectorOrderSchema,
  type ConnectorOrder,
} from "@/validators/connector";


/**
 * The attribute keys the FEED owns on an order it holds. On every connector
 * write they are replaced as a set (a null value removes the key); an upload
 * never changes them on such an order ("the Salla feed wins").
 */
export const CONNECTOR_OWNED_KEYS: readonly string[] = [
  STORE_SOURCE_FIELD_KEY,
  STORE_CHANNEL_FIELD_KEY,
  ORDER_STATUS_FIELD_KEY,
  ...FEED_FIELD_KEYS,
];

/**
 * The customer keys the feed FILLS when Salla sends them (personal data is
 * opened per app; without it the keys are absent). Unlike the owned keys they
 * are never removed and an upload may still set them: a missing name is "not
 * sent", not "no name".
 */
export const CONNECTOR_CUSTOMER_KEYS = {
  name: "customer_name",
  phone: "phone",
  email: "email",
} as const;

const ORDER_ID_MAX = 64;
const TOTAL_LIMIT = 1e10;
/** `store_source_mappings.raw_value` / `store_channel_mappings.raw_value`. */
const RAW_VALUE_MAX = 128;

export interface MappedConnectorOrder {
  orderId: string;
  /** The Riyadh day the order was created, `YYYY-MM-DD`. */
  orderDate: string;
  /** `numeric(12,2)` as text. */
  totalAmount: string;
  /** Only the keys that HAVE a value; money is a number (SAR), the rest text. */
  attributes: Record<string, string | number>;
  /** The connector's `updated_at` (ISO), or null when it sent none. */
  updatedAt: string | null;
  /** The order's product lines, in the order the connector sent them. */
  items: MappedOrderItem[];
}

export interface MappedOrderItem {
  position: number;
  sku: string | null;
  name: string | null;
  quantity: number;
  /** The line incl. VAT in SAR, `numeric(12,2)` as text; null when no rate converts it. */
  lineTotalSar: string | null;
}

/** More lines than this on one order is not a real order; the rest are kept raw only. */
const ITEMS_MAX = 200;
const SKU_MAX = 128;
const NAME_MAX = 500;

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, RAW_VALUE_MAX) : null;
}

/** A finite money value inside the column's range, or null. */
function toAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && Math.abs(n) < TOTAL_LIMIT ? n : null;
}

function isoInstant(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * A connector order → the row the Store module stores. Pure. Returns null when
 * the order can't be a Store row (no reference, no readable Riyadh date, no
 * usable total) — the raw event is kept either way; it is only not APPLIED.
 *
 * - order id   = `reference` (Salla's order number)
 * - order date = the DATE PART of `created_at`, which the connector sends in
 *   Riyadh time (`+03:00`) — `parseStoreDate` refuses any other zone, so a
 *   23:30 Riyadh order is never filed under the next UTC day
 * - total      = `amounts.total_sar` (incl. VAT, shipping and COD fee) — the
 *   Store module is SAR. A payload from before the connector sent it falls
 *   back to `amounts.total` only when the order is SAR or names no currency;
 *   a foreign-currency order without a SAR total is not applied (never a
 *   QAR figure filed as riyals)
 * - customer_name / phone / email = `customer.*` when sent; the phone is
 *   written `+<digits>`, the form Salla's export uses
 * - utm_source = `attribution.utm_source`, channel = `attribution.device`,
 *   order_status = `status.slug`, and every `store/feed-fields.ts` key
 *   (`FEED_READERS`) — all OWNED: replaced as a set on every write
 * - items = `items[]` → product lines, each `total` (incl. VAT) in SAR via
 *   `exchange_rate` (see `mapItems`)
 */
export function mapConnectorOrder(raw: unknown): MappedConnectorOrder | null {
  const parsed = connectorOrderSchema.safeParse(raw);
  if (!parsed.success) return null;
  const o = parsed.data;

  const orderId = String(o.reference ?? "").trim();
  if (!orderId || orderId.length > ORDER_ID_MAX) return null;

  const orderDate = o.created_at ? parseStoreDate(o.created_at) : null;
  if (!orderDate) return null;

  const currency = clean(o.currency)?.toUpperCase() ?? null;
  const sar = toAmount(o.amounts?.total_sar);
  const total =
    sar ?? (currency === null || currency === "SAR" ? toAmount(o.amounts?.total) : null);
  if (total === null) return null;

  const rate = sarRate(currency, o.exchange_rate);
  const attributes: Record<string, string | number> = {};
  const source = clean(o.attribution?.utm_source);
  if (source) attributes[STORE_SOURCE_FIELD_KEY] = source;
  const channel = clean(o.attribution?.device);
  if (channel) attributes[STORE_CHANNEL_FIELD_KEY] = channel;
  const status = clean(o.status?.slug);
  if (status) attributes[ORDER_STATUS_FIELD_KEY] = status;

  const name = clean(o.customer?.name);
  if (name) attributes[CONNECTOR_CUSTOMER_KEYS.name] = name;
  const digits = (o.customer?.phone ?? "").replace(/\D/g, "");
  if (digits) attributes[CONNECTOR_CUSTOMER_KEYS.phone] = `+${digits}`.slice(0, RAW_VALUE_MAX);
  const email = clean(o.customer?.email);
  if (email) attributes[CONNECTOR_CUSTOMER_KEYS.email] = email;

  for (const key of FEED_FIELD_KEYS) {
    const v = FEED_READERS[key](o, rate);
    if (v !== null) attributes[key] = v;
  }

  return {
    orderId,
    orderDate,
    totalAmount: total.toFixed(2),
    attributes,
    updatedAt: isoInstant(o.updated_at),
    items: mapItems(o.items, rate),
  };
}

/** An amount in the order's currency → SAR, 2 decimals; null without a rate. */
function toSar(v: string | number | null | undefined, rate: number | null): number | null {
  const n = toAmount(v);
  if (n === null || rate === null) return null;
  return Math.round(n * rate * 100) / 100;
}

/** The non-blank strings of a list, joined — tags, coupon codes. */
function joined(list: unknown[] | null | undefined, pick: (x: unknown) => string | null): string | null {
  const parts = (list ?? []).map(pick).filter((s): s is string => !!s);
  return parts.length ? parts.join(", ").slice(0, RAW_VALUE_MAX) : null;
}

const coupons = (o: ConnectorOrder) =>
  (o.coupons ?? []).flatMap((c) => {
    const p = connectorCouponSchema.safeParse(c);
    return p.success ? [p.data] : [];
  });

const offers = (o: ConnectorOrder) =>
  (o.offers ?? []).flatMap((c) => {
    const p = connectorOfferSchema.safeParse(c);
    return p.success ? [p.data] : [];
  });

const PAYMENT_TYPE: Record<string, string> = { cod: "COD", prepaid: "Prepaid" };

/**
 * How each feed field is read from a connector order (`store/feed-fields.ts`
 * lists them). Typed by key, so a field added there without a reader here
 * fails to compile. Null = not sent, and the owned key is removed.
 */
const FEED_READERS: Record<FeedFieldKey, (o: ConnectorOrder, rate: number | null) => string | number | null> = {
  payment_method: (o) => clean(o.payment_method_raw) ?? clean(o.payment_method),
  payment_type: (o) => {
    const p = clean(o.payment_method)?.toLowerCase();
    return p ? (PAYMENT_TYPE[p] ?? p) : null;
  },
  coupon_code: (o) => joined(coupons(o), (c) => clean((c as { code?: string | null }).code)),
  coupon_discount: (o, rate) => {
    const list = coupons(o);
    if (list.length === 0) return null;
    return toSar(list.reduce((a, c) => a + (toAmount(c.discount) ?? 0), 0), rate);
  },
  discount: (o, rate) => toSar(o.amounts?.discount, rate),
  subtotal: (o, rate) => toSar(o.amounts?.subtotal_excl_vat, rate),
  shipping_fee: (o, rate) => toSar(o.amounts?.shipping, rate),
  cod_fee: (o, rate) => toSar(o.amounts?.cod_fee, rate),
  vat: (o, rate) => toSar(o.amounts?.tax, rate),
  city: (o) => clean(o.shipping?.city),
  country: (o) => clean(o.shipping?.country),
  shipping_company: (o) => clean(o.shipping?.company),
  tracking_number: (o) => clean(o.shipping?.tracking_number),
  delivered_date: (o) => (o.shipping?.delivered_at ? parseStoreDate(o.shipping.delivered_at) : null),
  refund_amount: (o, rate) => toSar(o.refund?.amount, rate),
  tags: (o) => joined(o.tags, (t) => (typeof t === "string" ? clean(t) : null)),
  utm_medium: (o) => clean(o.attribution?.utm_medium),
  utm_campaign: (o) => clean(o.attribution?.utm_campaign),
  utm_term: (o) => clean(o.attribution?.utm_term),
  utm_content: (o) => clean(o.attribution?.utm_content),
  salla_source: (o) => clean(o.source),
  entry: (o) => clean(o.attribution?.entry),
  currency: (o) => clean(o.currency)?.toUpperCase() ?? null,
  exchange_rate: (o) => toAmount(o.exchange_rate),
  offers: (o) => joined(offers(o), (c) => clean((c as { name?: string | null }).name)),
  // The order's own total when sent; else the lines' sum. 0 with no offer = not set.
  offers_discount: (o, rate) => {
    const sent = toAmount(o.amounts?.offers_discount);
    const total = sent ?? (offers(o).length ? offers(o).reduce((a, c) => a + (toAmount(c.discount) ?? 0), 0) : null);
    return total === null || (total === 0 && offers(o).length === 0) ? null : toSar(total, rate);
  },
  salla_customer_id: (o) =>
    o.customer?.salla_id === null || o.customer?.salla_id === undefined
      ? null
      : clean(String(o.customer.salla_id)),
};

/** SAR per unit of the order's currency: 1 for SAR (or no currency named), else the sent rate. */
function sarRate(currency: string | null, rate: string | number | null | undefined): number | null {
  if (currency === null || currency === "SAR") return 1;
  const r = toAmount(rate);
  return r !== null && r > 0 ? r : null;
}

function trimTo(v: string | null | undefined, max: number): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/**
 * `order.items[]` → the lines Wizard stores. A line with no readable quantity
 * is skipped (kept in the raw payload); a fractional quantity rounds.
 */
function mapItems(raw: unknown[] | null | undefined, rate: number | null): MappedOrderItem[] {
  const out: MappedOrderItem[] = [];
  for (const [position, line] of (raw ?? []).slice(0, ITEMS_MAX).entries()) {
    const parsed = connectorItemSchema.safeParse(line);
    if (!parsed.success) continue;
    const l = parsed.data;
    const q = toAmount(l.quantity);
    if (q === null) continue;
    const t = toAmount(l.total);
    const sar = t !== null && rate !== null ? t * rate : null;
    out.push({
      position,
      sku: trimTo(l.sku, SKU_MAX),
      name: trimTo(l.name, NAME_MAX),
      quantity: Math.round(q),
      lineTotalSar: sar !== null && Math.abs(sar) < TOTAL_LIMIT ? sar.toFixed(2) : null,
    });
  }
  return out;
}
