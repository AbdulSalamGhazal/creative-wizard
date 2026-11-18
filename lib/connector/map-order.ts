import { parseStoreDate } from "@/store/parse";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { STORE_CHANNEL_FIELD_KEY } from "@/store/channels";
import { ORDER_STATUS_FIELD_KEY } from "@/store/order-status";
import { connectorOrderSchema } from "@/validators/connector";


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
}

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, RAW_VALUE_MAX) : null;
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
 * - total      = `amounts.total` (incl. VAT, shipping and COD fee)
 * - utm_source = `attribution.utm_source`, channel = `attribution.device`,
 *   order_status = `status.slug`
 */
export function mapConnectorOrder(raw: unknown): MappedConnectorOrder | null {
  const parsed = connectorOrderSchema.safeParse(raw);
  if (!parsed.success) return null;
  const o = parsed.data;

  const orderId = String(o.reference ?? "").trim();
  if (!orderId || orderId.length > ORDER_ID_MAX) return null;

  const orderDate = o.created_at ? parseStoreDate(o.created_at) : null;
  if (!orderDate) return null;

  const rawTotal = o.amounts?.total;
  if (rawTotal === null || rawTotal === undefined || rawTotal === "") return null;
  const total = typeof rawTotal === "number" ? rawTotal : Number(rawTotal);
  if (!Number.isFinite(total) || Math.abs(total) >= TOTAL_LIMIT) return null;

  const attributes: Record<string, string> = {};
  const source = clean(o.attribution?.utm_source);
  if (source) attributes[STORE_SOURCE_FIELD_KEY] = source;
  const channel = clean(o.attribution?.device);
  if (channel) attributes[STORE_CHANNEL_FIELD_KEY] = channel;
  const status = clean(o.status?.slug);
  if (status) attributes[ORDER_STATUS_FIELD_KEY] = status;

  return {
    orderId,
    orderDate,
    totalAmount: total.toFixed(2),
    attributes,
    updatedAt: isoInstant(o.updated_at),
  };
}
