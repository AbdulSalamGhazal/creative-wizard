import { z } from "zod";
import { platformEnum } from "@/lib/enums";
import type { CompareMetric } from "@/db/queries/performance";
import { defaultDateRange } from "@/lib/date-presets";
import { parseCsvEnum } from "@/validators/shared";

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
  return uniq(parseCsvEnum(s, platformEnum));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids only — a token that isn't a uuid is dropped, never sent to the query. */
function csvUuids(s: string | undefined): string[] {
  return csvList(s).filter((v) => UUID.test(v));
}

/**
 * The Landing page picker's "Product page" option — records whose ad name
 * carried no ` @code`. Not a uuid, so it never collides with a registered
 * page's id in the same CSV param.
 */
export const OWN_LANDING_PAGE = "own";

/** Side slots. A and B are always shown; C appears via "Add side". */
export const SIDE_KEYS = ["a", "b", "c"] as const;
export type SideKey = (typeof SIDE_KEYS)[number];

export interface CompareSide {
  key: SideKey;
  /** Display label ("Side A"). */
  label: string;
  platforms: Platform[];
  /**
   * CAMPAIGN ids (`parent_campaigns` rows, 2026-11) — a whole campaign, every
   * ad set under it. Ids, not names: a name is unique only per network.
   */
  parents: string[];
  /** AD SETS, by stored name (the combined "Campaign ➤ Adset" value). */
  campaigns: string[];
  /** Creative ids. */
  creatives: string[];
  /** Registered landing page ids, and/or `OWN_LANDING_PAGE`. */
  landingPages: string[];
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
 * 5-level filter (Platform → Campaign → Ad set → Creative → Landing page; an
 * empty level = "all"; `xParents` is the campaign, `xCampaigns` the ad set —
 * lib/campaign.ts "TWO LEVELS") plus
 * an optional side-specific time window (`aFrom`/`aTo`, …) that overrides the
 * shared `from`/`to`. Side params are CSV in the URL. The third side renders
 * when `sides=3` or when any `c*` param carries state (so shared URLs keep
 * their third side even if the flag is dropped).
 */
export const compareFiltersSchema = z
  .object({
    aPlatforms: z.string().optional(),
    aParents: z.string().optional(),
    aCampaigns: z.string().optional(),
    aCreatives: z.string().optional(),
    aLandingPages: z.string().optional(),
    aFrom: z.string().optional(),
    aTo: z.string().optional(),
    bPlatforms: z.string().optional(),
    bParents: z.string().optional(),
    bCampaigns: z.string().optional(),
    bCreatives: z.string().optional(),
    bLandingPages: z.string().optional(),
    bFrom: z.string().optional(),
    bTo: z.string().optional(),
    cPlatforms: z.string().optional(),
    cParents: z.string().optional(),
    cCampaigns: z.string().optional(),
    cCreatives: z.string().optional(),
    cLandingPages: z.string().optional(),
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
      parents: string | undefined,
      campaigns: string | undefined,
      creatives: string | undefined,
      landingPages: string | undefined,
      from: string | undefined,
      to: string | undefined,
    ): CompareSide => {
      const r = sideRange(from, to);
      return {
        key,
        label: `Side ${key.toUpperCase()}`,
        platforms: csvPlatforms(platforms),
        parents: csvUuids(parents),
        campaigns: csvList(campaigns),
        creatives: csvList(creatives),
        landingPages: csvList(landingPages),
        from: r?.from ?? null,
        to: r?.to ?? null,
      };
    };
    const sides: CompareSide[] = [
      mk("a", v.aPlatforms, v.aParents, v.aCampaigns, v.aCreatives, v.aLandingPages, v.aFrom, v.aTo),
      mk("b", v.bPlatforms, v.bParents, v.bCampaigns, v.bCreatives, v.bLandingPages, v.bFrom, v.bTo),
    ];
    const c = mk("c", v.cPlatforms, v.cParents, v.cCampaigns, v.cCreatives, v.cLandingPages, v.cFrom, v.cTo);
    if (v.sides === "3" || !sideIsEmpty(c) || c.from !== null) sides.push(c);
    return { sides, metrics: v.metrics, from: v.from, to: v.to };
  });

/** True when a side has no selection at any level (i.e. "all data"). */
export function sideIsEmpty(
  s: Pick<CompareSide, "platforms" | "parents" | "campaigns" | "creatives" | "landingPages">,
): boolean {
  return (
    s.platforms.length === 0 &&
    s.parents.length === 0 &&
    s.campaigns.length === 0 &&
    s.creatives.length === 0 &&
    s.landingPages.length === 0
  );
}

/** A side's landing-page selection as `KpiFilters` reads it. */
export function sideLandingFilter(landingPages: readonly string[]): {
  landingPageIds?: string[];
  ownLandingPage?: boolean;
} {
  const ids = landingPages.filter((v) => v !== OWN_LANDING_PAGE);
  return {
    landingPageIds: ids.length ? ids : undefined,
    ownLandingPage: landingPages.includes(OWN_LANDING_PAGE) || undefined,
  };
}
