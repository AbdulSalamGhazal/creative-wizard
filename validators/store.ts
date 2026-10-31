import { z } from "zod";
import { platformEnum } from "@/lib/enums";
import { SORT_DIRS, csvEnum } from "@/validators/shared";
import { CORE_KEYS } from "@/store/fields";
import { CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";

/**
 * URL filters for the Store orders table — date range + order-id search ONLY.
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
});

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
