import type { ChipTone } from "@/components/ui/chip";

/**
 * The order status the Salla feed writes — the store's own status SLUG, kept
 * verbatim in `attributes.order_status`. Plain module: the Orders table (a
 * client component) and the feed's mapper both read it.
 */
export const ORDER_STATUS_FIELD_KEY = "order_status";

/**
 * Salla's status slugs as the connector documents them (2026-11-18). The
 * stored value stays the slug; this is only how the table words it.
 * `status.label` is NOT used: it is each store's own Arabic wording and
 * differs between stores.
 */
const KNOWN_STATUS_LABELS: Record<string, string> = {
  payment_pending: "Payment pending",
  under_review: "Under review",
  in_progress: "In progress",
  completed: "Ready to ship",
  shipped: "Shipped",
  delivering: "Out for delivery",
  delivered: "Delivered",
  canceled: "Cancelled",
  restoring: "Return in progress",
  restored: "Refunded",
  deleted: "Deleted",
};

/** A known slug reads as its meaning; an unknown one is humanized, never hidden. */
export function orderStatusLabel(slug: string): string {
  const known = KNOWN_STATUS_LABELS[slug.toLowerCase()];
  if (known) return known;
  const s = slug.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : slug;
}

/**
 * Every status is coloured BY STAGE (user decision 2026-11-23): waiting grey
 * · on the way blue · delivered green · refunded amber · cancelled red.
 * Matched loosely so a new Salla slug of the same family is still caught; an
 * unknown one is grey.
 */
export function orderStatusTone(slug: string): Extract<ChipTone, "neutral" | "info" | "pos" | "warn" | "neg"> {
  const s = slug.toLowerCase();
  if (s.includes("cancel") || s === "deleted") return "neg";
  if (s.includes("refund") || s.includes("restor")) return "warn";
  if (s === "delivered") return "pos";
  if (s === "shipped" || s.includes("delivering")) return "info";
  return "neutral";
}

/**
 * The Orders page's status TABS (user decision 2026-11-27): Salla's slugs
 * grouped into the stages a merchant works in. Matched loosely like
 * `orderStatusTone` (cancelled first, then refunded), so a new slug of a known
 * family lands in its stage; an unknown one is "in progress". `none` = no
 * status at all (an uploaded order), its own tab only when it has orders.
 * The SQL twin is `orderStageSql` (db/queries/store.ts), pinned to this.
 */
export const ORDER_STAGES = [
  "awaiting",
  "in_progress",
  "on_the_way",
  "delivered",
  "cancelled",
  "refunded",
  "none",
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export const ORDER_STAGE_LABEL: Record<OrderStage, string> = {
  awaiting: "Awaiting payment",
  in_progress: "In progress",
  on_the_way: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
  none: "No status",
};

export function orderStatusStage(slug: string | null | undefined): OrderStage {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s) return "none";
  if (s.includes("cancel") || s === "deleted") return "cancelled";
  if (s.includes("refund") || s.includes("restor")) return "refunded";
  if (s === "delivered") return "delivered";
  if (s === "shipped" || s.includes("delivering")) return "on_the_way";
  if (s === "payment_pending") return "awaiting";
  return "in_progress";
}

/**
 * The Orders table's Source column: where an order came from. The key starts
 * with `_`, which `slugifyKey` can never produce, so no custom field collides.
 */
export const ORDER_SOURCE_COLUMN_KEY = "_source";
export const orderSourceLabel = (fromFeed: boolean) => (fromFeed ? "Salla" : "Upload");
