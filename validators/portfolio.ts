import { z } from "zod";
import { campaignObjectiveEnum, platformEnum } from "@/lib/enums";
import { CAMPAIGN_STATUSES } from "@/lib/campaign-status";
import { defaultDateRange } from "@/lib/date-presets";
import { SORT_DIRS, csvEnum } from "@/validators/shared";

/**
 * URL-state filters for the "All Campaigns" portfolio page.
 *
 * Distinct from the global dashboard filters — this surface is portfolio
 * altitude: date range, platform + objective multi-select, and a campaign-name
 * search. No product/type/angle (those live on the creative surfaces). A bad
 * token is dropped and its valid siblings kept (`csvEnum`), never thrown.
 */

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
  objectives: csvEnum(campaignObjectiveEnum),
  statuses: csvEnum(CAMPAIGN_STATUSES),
  q: z.string().trim().min(1).max(120).optional().catch(undefined),
  includeExcluded: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
  // Rich-table state (the campaigns table reads these from the URL so saved
  // views capture sort + hidden columns). Unknown values fall back in the table.
  sort: z.string().max(24).optional().catch(undefined),
  dir: z.enum(SORT_DIRS).optional().catch(undefined),
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
