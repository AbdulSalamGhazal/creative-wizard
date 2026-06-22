import { z } from "zod";
import { platformEnum } from "@/db/schema";
import { defaultDateRange } from "@/lib/date-presets";

/**
 * URL-state filters for the "All Campaigns" portfolio page.
 *
 * Distinct from the global dashboard filters — this surface is portfolio
 * altitude: date range + comparison mode, platform multi-select, and a
 * campaign-name search. No product/type/tag (those live on the creative
 * surfaces). A bad value drops the filter rather than throwing.
 */

function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)))
    .catch([]);
}

export const portfolioFiltersSchema = z.object({
  // Default to the last 7 days when no range is set (Lifetime is concrete).
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
  platforms: csvEnum(platformEnum),
  q: z.string().trim().min(1).max(120).optional().catch(undefined),
  compare: z.enum(["prev", "wow", "mom"]).default("prev").catch("prev"),
  includeExcluded: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
  // Rich-table state (the campaigns table reads these from the URL so saved
  // views capture sort + hidden columns). Unknown values fall back in the table.
  sort: z.string().max(24).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  hide: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .catch([]),
  order: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .catch([]),
});

export type PortfolioFiltersInput = z.infer<typeof portfolioFiltersSchema>;
