import { z } from "zod";
import { platformEnum } from "@/db/schema";
import type { CompareMetric } from "@/db/queries/performance";

type Platform = (typeof platformEnum)[number];

/** Metrics offered in the Compare view. Order drives the picker menus. */
export const COMPARE_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "ctr",
  "cvr",
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
  cvr: "Conversion rate (CvR)",
  cpm: "CPM",
  cpc: "CPC",
  cpa: "CPA",
  roas: "ROAS",
  hookRate: "Hook rate",
};

export const MAX_COMPARE_BLOCKS = 6;

/** Dedup-preserving-order helper. */
function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function csvList(s: string | undefined): string[] {
  return s ? uniq(s.split(",").filter(Boolean)) : [];
}

function csvPlatforms(s: string | undefined): Platform[] {
  const valid = new Set<string>(platformEnum as readonly string[]);
  return csvList(s).filter((p): p is Platform => valid.has(p));
}

export interface CompareSide {
  platforms: Platform[];
  /** Combined "Campaign ➤ Adset" values. */
  campaigns: string[];
  /** Creative ids. */
  creatives: string[];
}

/**
 * Compare is a two-sided A-vs-B comparison. Each side is defined by an
 * independent 3-level filter (Platform → Campaign → Creative); an empty level
 * means "all" at that level. Side params are CSV in the URL.
 */
export const compareFiltersSchema = z
  .object({
    aPlatforms: z.string().optional(),
    aCampaigns: z.string().optional(),
    aCreatives: z.string().optional(),
    bPlatforms: z.string().optional(),
    bCampaigns: z.string().optional(),
    bCreatives: z.string().optional(),
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
  })
  .transform((v) => ({
    sideA: {
      platforms: csvPlatforms(v.aPlatforms),
      campaigns: csvList(v.aCampaigns),
      creatives: csvList(v.aCreatives),
    } as CompareSide,
    sideB: {
      platforms: csvPlatforms(v.bPlatforms),
      campaigns: csvList(v.bCampaigns),
      creatives: csvList(v.bCreatives),
    } as CompareSide,
    metrics: v.metrics,
    from: v.from,
    to: v.to,
  }));

export type CompareFilters = z.infer<typeof compareFiltersSchema>;

/** True when a side has no selection at any level (i.e. "all data"). */
export function sideIsEmpty(s: CompareSide): boolean {
  return (
    s.platforms.length === 0 &&
    s.campaigns.length === 0 &&
    s.creatives.length === 0
  );
}
