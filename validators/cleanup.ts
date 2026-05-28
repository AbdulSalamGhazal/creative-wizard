import { z } from "zod";
import { platformEnum } from "@/db/schema";

/**
 * Filters for the admin record-cleanup tool. All present filters combine
 * with AND. At least one must be set — the tool refuses to match
 * "everything" by accident.
 *
 * The date filter requires both ends; a half-open range is treated as
 * "no date filter".
 */
export const cleanupFiltersSchema = z
  .object({
    platforms: z.array(z.enum(platformEnum)).default([]),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    productIds: z.array(z.string().uuid()).default([]),
    creativeIds: z.array(z.string().uuid()).default([]),
  })
  .refine(
    (f) =>
      f.platforms.length > 0 ||
      (!!f.from && !!f.to) ||
      f.productIds.length > 0 ||
      f.creativeIds.length > 0,
    { message: "Select at least one filter before previewing or deleting." },
  );

export type CleanupFilters = z.infer<typeof cleanupFiltersSchema>;
