import { z } from "zod";
import { platformEnum, creativeTypeEnum } from "@/lib/enums";
import { defaultDateRange } from "@/lib/date-presets";
import { csvEnum } from "@/validators/shared";

// Global dashboard filters encoded in URL searchParams.
// See docs/prd.md §5.4 and docs/tech-spec.md §8.1.

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
  // The OLD manual `statuses` filter was retired — status is DERIVED now and
  // can't be a SQL WHERE on the aggregate views. The Library/Summary status
  // filters live in their own validators and are unaffected.
  angles: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : [])),
  includeExcluded: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
});

/** Breakdown dimension for Trends → Over time. Unknown values → campaign. */
export const changeDimSchema = z
  .enum(["platform", "campaign", "creative"])
  .catch("campaign");
