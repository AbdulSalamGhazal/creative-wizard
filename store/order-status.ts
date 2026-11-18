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
 * The statuses that change what an order MEANS get a tone; every other
 * status is plain text. Matched loosely so a new Salla slug of the same
 * family is still caught.
 */
export function orderStatusTone(slug: string): Extract<ChipTone, "neg" | "warn"> | null {
  const s = slug.toLowerCase();
  if (s.includes("cancel") || s === "deleted") return "neg";
  if (s.includes("refund") || s.includes("restor")) return "warn";
  return null;
}

/**
 * The Orders table's Source column: where an order came from. The key starts
 * with `_`, which `slugifyKey` can never produce, so no custom field collides.
 */
export const ORDER_SOURCE_COLUMN_KEY = "_source";
export const orderSourceLabel = (fromFeed: boolean) => (fromFeed ? "Salla" : "Upload");
