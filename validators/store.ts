import { z } from "zod";
import { platformEnum, storeFieldTypeEnum } from "@/lib/enums";
import { SORT_DIRS, csvEnum, csvList } from "@/validators/shared";
import { ORDER_STAGES } from "@/store/order-status";
import { CORE_KEYS } from "@/store/fields";
import { CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";

/**
 * URL filters for the Store orders table — range, search (order + customer,
 * 2026-11-27), the status tab and the Filters dialog's lists.
 * A malformed or impossible date is DROPPED (the saved range then applies),
 * never a thrown parse: `?from=abc` used to error the whole page (2026-10-31).
 */
export const storeOrdersFiltersSchema = z.object({
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
  q: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
  page: z.coerce.number().int().min(1).catch(1),
  sort: z.enum(CORE_KEYS).catch("order_date"),
  dir: z.enum(SORT_DIRS).catch("desc"),
  /** The status tab (2026-11-27); absent = All. An unknown stage reads as All. */
  stage: z.enum(ORDER_STAGES).optional().catch(undefined),
  /** Filters (2026-11-27). Free values (a payment slug, a SKU, a coupon) are
   *  matched exactly, so an unknown one simply matches nothing. */
  payments: csvList(),
  paymentTypes: csvList(),
  platforms: csvEnum([...platformEnum, UNATTRIBUTED]),
  channels: csvEnum([...CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL]),
  /** Product keys (SKU, or the name when Salla sent none). Not `products`:
   *  that remembered key holds the ads pages' product ids. */
  skus: csvList(),
  coupons: csvList(),
  offers: csvList(),
  /** The shipping country as Salla sends it (2026-11-27). */
  countries: csvList(),
});

/**
 * The Orders CSV button's payload: the page's raw URL params, as strings.
 * Only the shape is checked here — `resolveStoreOrderFilters` resolves and
 * parses them exactly as the page does.
 */
export const storeOrdersExportParamsSchema = z
  .record(z.string().max(64), z.string().max(4000))
  .catch({});

/**
 * Filters for the order-cleanup tool (mirror of the ads `cleanupFiltersSchema`).
 * All present filters combine with AND; at least one must be set — the tool
 * refuses to match "everything" by accident. `orderIds` accepts an exact id or a
 * comma-separated list (already split into an array by the client).
 */
export const storeCleanupFiltersSchema = z
  .object({
    // Real dates, not just the shape — `2026-02-30` reached Postgres (22008).
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    batchId: z.string().uuid().optional(),
    orderIds: z.array(z.string().trim().min(1)).default([]),
  })
  .refine(
    (f) => (!!f.from && !!f.to) || !!f.batchId || f.orderIds.length > 0,
    { message: "Select at least one filter before previewing or deleting." },
  );

/** The previewed order count a delete must match (W1-7). */
export const storeCleanupExpectedSchema = z.object({
  expectedRows: z
    .number({ required_error: "Preview the impact before deleting." })
    .int()
    .min(1),
});

/**
 * Assign a raw source value: one of the 4 platforms, "none" ("not an ad
 * platform" → a row with platform NULL), or "unset" (delete the row → unmapped).
 */
export const storeSourceMappingSchema = z.object({
  rawValue: z.string().trim().min(1).max(128),
  assignment: z.enum([...platformEnum, "none", "unset"]),
});

/**
 * Assign a raw CHANNEL value: 'website', 'application', or "unset" (delete the
 * row → the value returns to the Unmapped bucket). Derived from
 * `CHANNEL_DESTINATIONS`, never re-listed.
 */
export const storeChannelMappingSchema = z.object({
  rawValue: z.string().trim().min(1).max(128),
  assignment: z.enum([...CHANNEL_DESTINATIONS, "unset"]),
});

/**
 * Product costs (Store → Product costs). A cost is SAR per unit, ≥ 0, two
 * decimals, from a day (the cost in force for every order on or after it until
 * a later one). The product key is an order line's SKU, or its name.
 */
export const storeProductCostSchema = z.object({
  productKey: z.string().trim().min(1, "Choose a product").max(500),
  unitCost: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a cost in SAR, like 84 or 84.50"),
  effectiveFrom: z.string().date("Choose a date"),
});

export const storeProductCostDeleteSchema = z.object({ id: z.string().uuid() });

/**
 * URL filters for Store Insights — the date range, the two mapped-bucket
 * filters, and the analyzed dimension. `by` is validated against the DERIVED
 * dimension list on the page (a field can be deleted), so it is a plain string
 * here; the csv helpers keep the two bucket lists tied to their vocabularies.
 */
export const storeInsightsFiltersSchema = z.object({
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
  by: z
    .string()
    .max(64)
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
  /** Platform buckets: the four platforms, or the Unattributed sentinel. */
  platforms: csvEnum([...platformEnum, UNATTRIBUTED]),
  /** Channel buckets: Website / Application, or the Unmapped sentinel. */
  channels: csvEnum([...CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL]),
  /**
   * `?compare=1` — set the range against the previous window of the same
   * length (user decision 2026-11-27: a toggle, OFF by default, not
   * remembered). Anything else reads as off.
   */
  compare: z
    .string()
    .optional()
    .transform((s) => s === "1"),
});

/** URL filters for the Reconciliation page — date range only. */
export const reconciliationFiltersSchema = z.object({
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
});

/**
 * URL filters for the UTMs page — date range only. `?compare=` is a SHALLOW
 * presentation param the client reads itself (which sources are overlaid),
 * so the server never parses it.
 */
export const storeUtmsFiltersSchema = z.object({
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
});

/**
 * Custom order fields (`app/actions/store-field.ts`). Moved here verbatim
 * 2026-11-19 — the same checks and messages.
 */
export const storeFieldHeadersSchema = z.array(z.string().trim().min(1).max(255)).max(20);

export const storeFieldCreateSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(64),
  type: z.enum(storeFieldTypeEnum),
  required: z.boolean().default(false),
  headers: storeFieldHeadersSchema.default([]),
});

export const storeFieldUpdateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(64).optional(),
  required: z.boolean().optional(),
  headers: storeFieldHeadersSchema.optional(),
});
