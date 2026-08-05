import { z } from "zod";
import { platformEnum } from "@/db/schema";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** URL filters for the Store orders table — date range + order-id search ONLY. */
export const storeOrdersFiltersSchema = z.object({
  from: z.string().regex(ISO).optional(),
  to: z.string().regex(ISO).optional(),
  q: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
  page: z.coerce.number().int().min(1).catch(1),
  sort: z.enum(["order_id", "order_date", "total_amount"]).catch("order_date"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});

export type StoreOrdersFilterInput = z.infer<typeof storeOrdersFiltersSchema>;

/**
 * Filters for the order-cleanup tool (mirror of the ads `cleanupFiltersSchema`).
 * All present filters combine with AND; at least one must be set — the tool
 * refuses to match "everything" by accident. `orderIds` accepts an exact id or a
 * comma-separated list (already split into an array by the client).
 */
export const storeCleanupFiltersSchema = z
  .object({
    from: z.string().regex(ISO).optional(),
    to: z.string().regex(ISO).optional(),
    batchId: z.string().uuid().optional(),
    orderIds: z.array(z.string().trim().min(1)).default([]),
  })
  .refine(
    (f) => (!!f.from && !!f.to) || !!f.batchId || f.orderIds.length > 0,
    { message: "Select at least one filter before previewing or deleting." },
  );

export type StoreCleanupFilters = z.infer<typeof storeCleanupFiltersSchema>;

/** Set (or clear, with null) the account's reconciliation source field. */
export const storeSourceFieldSchema = z.object({
  fieldKey: z.string().trim().min(1).max(48).nullable(),
});

/**
 * Assign a raw source value: one of the 4 platforms, "none" ("not an ad
 * platform" → a row with platform NULL), or "unset" (delete the row → unmapped).
 */
export const storeSourceMappingSchema = z.object({
  rawValue: z.string().trim().min(1).max(128),
  assignment: z.enum([...platformEnum, "none", "unset"]),
});

export type StoreSourceMappingInput = z.infer<typeof storeSourceMappingSchema>;

/** URL filters for the Reconciliation page — date range only. */
export const reconciliationFiltersSchema = z.object({
  from: z.string().regex(ISO).optional(),
  to: z.string().regex(ISO).optional(),
});
