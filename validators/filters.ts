import { z } from "zod";
import { platformEnum, creativeTypeEnum, creativeStatusEnum } from "@/db/schema";

// Global dashboard filters encoded in URL searchParams.
// See docs/prd.md §5.4 and docs/tech-spec.md §8.1.
const csv = (vals: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(vals as [string, ...string[]])));

export const dashboardFiltersSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  productIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : [])),
  platforms: csv(platformEnum),
  types: csv(creativeTypeEnum),
  statuses: csv(creativeStatusEnum),
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
