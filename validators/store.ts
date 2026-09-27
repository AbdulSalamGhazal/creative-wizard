import { z } from "zod";
import { platformEnum } from "@/db/schema";
import { CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A comma-separated URL param narrowed to a known vocabulary: unknown parts
 * are DROPPED silently (a retired platform, a hand-edited link, a remembered
 * value from another page), never an error and never a filter nobody asked
 * for. Empty → `[]`, which the queries read as "no filter".
 */
function csvOf<T extends string>(allowed: readonly T[]) {
  const set = new Set<string>(allowed);
  return z
    .string()
    .optional()
    .transform((s) =>
      (s ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter((v): v is T => set.has(v)),
    );
}

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

/**
 * Assign a raw source value: one of the 4 platforms, "none" ("not an ad
 * platform" → a row with platform NULL), or "unset" (delete the row → unmapped).
 */
export const storeSourceMappingSchema = z.object({
  rawValue: z.string().trim().min(1).max(128),
  assignment: z.enum([...platformEnum, "none", "unset"]),
});

export type StoreSourceMappingInput = z.infer<typeof storeSourceMappingSchema>;

/**
 * Assign a raw CHANNEL value: 'website', 'application', or "unset" (delete the
 * row → the value returns to the Unmapped bucket). Derived from
 * `CHANNEL_DESTINATIONS`, never re-listed.
 */
export const storeChannelMappingSchema = z.object({
  rawValue: z.string().trim().min(1).max(128),
  assignment: z.enum([...CHANNEL_DESTINATIONS, "unset"]),
});

export type StoreChannelMappingInput = z.infer<typeof storeChannelMappingSchema>;

/**
 * URL filters for Store Insights — the date range, the two mapped-bucket
 * filters, and the analyzed dimension. `by` is validated against the DERIVED
 * dimension list on the page (a field can be deleted), so it is a plain string
 * here; the csv helpers keep the two bucket lists tied to their vocabularies.
 */
export const storeInsightsFiltersSchema = z.object({
  from: z.string().regex(ISO).optional(),
  to: z.string().regex(ISO).optional(),
  by: z
    .string()
    .max(64)
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
  /** Platform buckets: the four platforms, or the Unattributed sentinel. */
  platforms: csvOf([...platformEnum, UNATTRIBUTED]),
  /** Channel buckets: Website / Application, or the Unmapped sentinel. */
  channels: csvOf([...CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL]),
});

export type StoreInsightsFilterInput = z.infer<typeof storeInsightsFiltersSchema>;

/** URL filters for the Reconciliation page — date range only. */
export const reconciliationFiltersSchema = z.object({
  from: z.string().regex(ISO).optional(),
  to: z.string().regex(ISO).optional(),
});
