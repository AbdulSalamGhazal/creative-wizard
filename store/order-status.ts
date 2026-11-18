import type { ChipTone } from "@/components/ui/chip";

/**
 * The order status the Salla feed writes — the store's own status SLUG, kept
 * verbatim in `attributes.order_status`. Plain module: the Orders table (a
 * client component) and the feed's mapper both read it.
 */
export const ORDER_STATUS_FIELD_KEY = "order_status";

/** `payment_pending` → "Payment pending". The slug stays what is stored. */
export function orderStatusLabel(slug: string): string {
  const s = slug.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : slug;
}

/**
 * The two statuses that change what an order MEANS get a tone; every other
 * status is plain text. Matched loosely, since the slugs are Salla's own:
 * a refund arrives as `restored` as well as `refunded`.
 */
export function orderStatusTone(slug: string): Extract<ChipTone, "neg" | "warn"> | null {
  const s = slug.toLowerCase();
  if (s.includes("cancel")) return "neg";
  if (s.includes("refund") || s.includes("restor")) return "warn";
  return null;
}

/**
 * The Orders table's Source column: where an order came from. The key starts
 * with `_`, which `slugifyKey` can never produce, so no custom field collides.
 */
export const ORDER_SOURCE_COLUMN_KEY = "_source";
export const orderSourceLabel = (fromFeed: boolean) => (fromFeed ? "Salla" : "Upload");
