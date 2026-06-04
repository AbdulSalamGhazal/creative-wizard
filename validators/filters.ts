import { z } from "zod";
import { platformEnum, creativeTypeEnum, creativeStatusEnum } from "@/db/schema";
import { defaultDateRange } from "@/lib/date-presets";

// Global dashboard filters encoded in URL searchParams.
// See docs/prd.md §5.4 and docs/tech-spec.md §8.1.

function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)))
    // A bad value in the CSV (e.g. a hand-edited URL) drops the filter rather
    // than throwing — the page renders unfiltered instead of erroring.
    .catch([]);
}

export const dashboardFiltersSchema = z.object({
  // Default to the last 7 days when no range is in the URL. Lifetime arrives
  // as a concrete floor→today range, so it isn't overridden.
  from: z
    .string()
    .date()
    .optional()
    .catch(undefined)
    .transform((v) => v ?? defaultDateRange().from),
  to: z
    .string()
    .date()
    .optional()
    .catch(undefined)
    .transform((v) => v ?? defaultDateRange().to),
  productIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : [])),
  platforms: csvEnum(platformEnum),
  types: csvEnum(creativeTypeEnum),
  statuses: csvEnum(creativeStatusEnum),
  tags: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : [])),
  includeExcluded: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
});

export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;
