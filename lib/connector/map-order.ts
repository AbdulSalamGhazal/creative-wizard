import { parseStoreDate } from "@/store/parse";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { STORE_CHANNEL_FIELD_KEY } from "@/store/channels";
import { ORDER_STATUS_FIELD_KEY } from "@/store/order-status";
import { connectorItemSchema, connectorOrderSchema } from "@/validators/connector";


/**
 * The attribute keys the FEED owns on an order it holds. On every connector
 * write they are replaced as a set (a null value removes the key); an upload
 * never changes them on such an order ("the Salla feed wins").
 */
export const CONNECTOR_OWNED_KEYS = [
  STORE_SOURCE_FIELD_KEY,
  STORE_CHANNEL_FIELD_KEY,
  ORDER_STATUS_FIELD_KEY,
] as const;

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
  /** Only the feed-owned keys that HAVE a value. */
  attributes: Record<string, string>;
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
 *   order_status = `status.slug`
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

  const attributes: Record<string, string> = {};
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

  return {
    orderId,
    orderDate,
    totalAmount: total.toFixed(2),
    attributes,
    updatedAt: isoInstant(o.updated_at),
    items: mapItems(o.items, sarRate(currency, o.exchange_rate)),
  };
}

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
