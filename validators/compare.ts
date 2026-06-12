import { z } from "zod";
import { platformEnum } from "@/db/schema";
import type { CompareMetric } from "@/db/queries/performance";
import { defaultDateRange } from "@/lib/date-presets";

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

/** Side slots. A and B are always shown; C appears via "Add side". */
export const SIDE_KEYS = ["a", "b", "c"] as const;
export type SideKey = (typeof SIDE_KEYS)[number];

export interface CompareSide {
  key: SideKey;
  /** Display label ("Side A"). */
  label: string;
  platforms: Platform[];
  /** Combined "Campaign ➤ Adset" values. */
  campaigns: string[];
  /** Creative ids. */
  creatives: string[];
  /** Side-specific window — null means "follow the shared range". */
  from: string | null;
  to: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A side window counts only when both ends are valid and ordered. */
function sideRange(
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string } | null {
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) {
    return { from, to };
  }
  return null;
}

/**
 * Compare is a 2-or-3-sided comparison. Each side is defined by an independent
 * 3-level filter (Platform → Campaign → Creative; an empty level = "all") plus
 * an optional side-specific time window (`aFrom`/`aTo`, …) that overrides the
 * shared `from`/`to`. Side params are CSV in the URL. The third side renders
 * when `sides=3` or when any `c*` param carries state (so shared URLs keep
 * their third side even if the flag is dropped).
 */
export const compareFiltersSchema = z
  .object({
    aPlatforms: z.string().optional(),
    aCampaigns: z.string().optional(),
    aCreatives: z.string().optional(),
    aFrom: z.string().optional(),
    aTo: z.string().optional(),
    bPlatforms: z.string().optional(),
    bCampaigns: z.string().optional(),
    bCreatives: z.string().optional(),
    bFrom: z.string().optional(),
    bTo: z.string().optional(),
    cPlatforms: z.string().optional(),
    cCampaigns: z.string().optional(),
    cCreatives: z.string().optional(),
    cFrom: z.string().optional(),
    cTo: z.string().optional(),
    sides: z.string().optional(),
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
  })
  .transform((v) => {
    const mk = (
      key: SideKey,
      platforms: string | undefined,
      campaigns: string | undefined,
      creatives: string | undefined,
      from: string | undefined,
      to: string | undefined,
    ): CompareSide => {
      const r = sideRange(from, to);
      return {
        key,
        label: `Side ${key.toUpperCase()}`,
        platforms: csvPlatforms(platforms),
        campaigns: csvList(campaigns),
        creatives: csvList(creatives),
        from: r?.from ?? null,
        to: r?.to ?? null,
      };
    };
    const sides: CompareSide[] = [
      mk("a", v.aPlatforms, v.aCampaigns, v.aCreatives, v.aFrom, v.aTo),
      mk("b", v.bPlatforms, v.bCampaigns, v.bCreatives, v.bFrom, v.bTo),
    ];
    const c = mk("c", v.cPlatforms, v.cCampaigns, v.cCreatives, v.cFrom, v.cTo);
    if (v.sides === "3" || !sideIsEmpty(c) || c.from !== null) sides.push(c);
    return { sides, metrics: v.metrics, from: v.from, to: v.to };
  });

export type CompareFilters = z.infer<typeof compareFiltersSchema>;

/** True when a side has no selection at any level (i.e. "all data"). */
export function sideIsEmpty(s: Pick<CompareSide, "platforms" | "campaigns" | "creatives">): boolean {
  return (
    s.platforms.length === 0 &&
    s.campaigns.length === 0 &&
    s.creatives.length === 0
  );
}
