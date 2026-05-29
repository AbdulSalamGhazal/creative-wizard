import { z } from "zod";
import type { CompareMetric } from "@/db/queries/performance";

/** Metrics offered in the Compare view. Order drives the picker menus. */
export const COMPARE_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "ctr",
  "cpm",
  "cpc",
  "cpa",
  "roas",
  "hookRate",
] as const;

export const COMPARE_METRIC_LABEL: Record<CompareMetric, string> = {
  spend: "Spend",
  impressions: "Impressions",
  clicks: "Clicks",
  conversions: "Conversions",
  ctr: "Click-through rate",
  cpm: "CPM",
  cpc: "CPC",
  cpa: "CPA",
  roas: "ROAS",
  hookRate: "Hook rate",
};

export const MAX_COMPARE_CREATIVES = 5;
export const MAX_COMPARE_BLOCKS = 6;

/** Dedup-preserving-order helper. */
function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export const compareFiltersSchema = z.object({
  // Up to 5 creatives.
  creativeIds: z
    .string()
    .optional()
    .transform((s) =>
      s ? uniq(s.split(",").filter(Boolean)).slice(0, MAX_COMPARE_CREATIVES) : [],
    ),
  // One or more metric blocks; defaults to a single Spend block. Capped + deduped.
  metrics: z
    .string()
    .optional()
    .transform((s): CompareMetric[] => {
      const list = s ? s.split(",").filter(Boolean) : [];
      const valid = list.filter((m): m is CompareMetric =>
        (COMPARE_METRICS as readonly string[]).includes(m),
      );
      const deduped = uniq(valid).slice(0, MAX_COMPARE_BLOCKS);
      return deduped.length > 0 ? deduped : ["spend"];
    }),
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
});

export type CompareFilters = z.infer<typeof compareFiltersSchema>;
