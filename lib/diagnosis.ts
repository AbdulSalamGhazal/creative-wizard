import { isFieldUnavailableOn, type InternalField } from "@/csv/platforms/types";
import type { platformEnum } from "@/db/schema";

type Platform = (typeof platformEnum)[number];

/**
 * AI campaign diagnosis — the PURE half: the bundle's shape, the serializer
 * that fills it, and the instructions the calling model follows.
 *
 * WHAT THIS IS (user decision, 2026-10 — "option 2"): the system does not
 * diagnose anything. It assembles everything a diagnosis needs into ONE
 * read-only payload and tells the user's own Claude how to work with it.
 * Nothing here calls an AI, holds an API key, or writes: adding any of those
 * would make this a different feature with a different risk profile.
 *
 * WHY IT IS PURE: a later in-system page ("option 3") must render the SAME
 * bundle from the same numbers. Assembly (db/queries/diagnosis.ts) and the MCP
 * envelope (lib/mcp/tools.ts) stay separate from this file so neither can
 * quietly become the source of truth.
 */

// ── Caps ────────────────────────────────────────────────────────────────────
// A bundle is read by a model with a finite context. Both caps are generous
// for the question being asked and small enough that a long-running campaign
// can't produce an unreadable payload; both are REPORTED when they bite, so a
// reader never mistakes a cap for the whole truth.

/** Creatives carried in full, ranked by IN-CAMPAIGN spend. */
export const MAX_DIAGNOSIS_CREATIVES = 20;
/** Weekly rollups kept BEFORE the daily window. */
export const MAX_DIAGNOSIS_WEEKS = 26;
/** Daily rows kept per creative (the recency the fatigue question needs). */
export const CREATIVE_DAILY_DAYS = 14;

// ── Input (what the assembler hands over) ───────────────────────────────────

export interface DiagnosisDayRow {
  date: string;
  /** 0 = a filled gap (no rows uploaded for that day), not a measured zero. */
  records: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
  addToCart: number;
  addPayment: number;
  videoViews2s: number;
  videoViews25: number;
  videoViews50: number;
  videoViews75: number;
  videoViews100: number;
}

export interface DiagnosisCreativeInput {
  creativeId: string;
  name: string;
  type: string;
  /** Derived status of this creative WITHIN this campaign. */
  statusHere: string;
  /** Derived status across the brand (it may be live elsewhere). */
  statusGeneral: string | null;
  stages: string[];
  priority: number | null;
  angles: string[];
  launchDate: string | null;
  product: string | null;
  inCampaign: {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    ctr: number | null;
    cvr: number | null;
    cpa: number | null;
    roas: number | null;
    lastDate: string | null;
  };
  /**
   * Last `CREATIVE_DAILY_DAYS` days inside this campaign, oldest first —
   * COMPONENT SUMS ONLY. The per-day ratios are deliberately absent: they are
   * derivable from these numbers, and the conventions already require every
   * period ratio to be recomputed from sums rather than averaged, so shipping
   * them would have been payload nobody is allowed to use as-is.
   */
  daily: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  /** The same window, everywhere else this creative ran. */
  elsewhere: {
    spend: number;
    revenue: number;
    roas: number | null;
    /** Distinct campaigns it ran in during the window, INCLUDING this one. */
    campaigns: number;
  };
}

export interface DiagnosisInput {
  generatedAt: string;
  brand: { id: string; name: string };
  campaign: {
    name: string;
    objective: string;
    platform: Platform | null;
    platforms: Platform[];
    status: string | null;
    products: string[];
    creativeCount: number;
    firstDate: string | null;
    lastDate: string | null;
  };
  window: { from: string; to: string; days: number };
  excludedRecords: "hidden" | "included";
  /** Latest uploaded day per platform — the Budget coverage anchor's data. */
  coverage: Record<string, string | null | undefined>;
  /**
   * Daily rows covering the window AND the history before it, oldest first.
   * The serializer splits them: the window stays daily, everything before it
   * is rolled into weeks.
   */
  days: DiagnosisDayRow[];
  lifetime: Record<string, number | null>;
  creatives: DiagnosisCreativeInput[];
  /** How many creatives existed before the cap. */
  creativesTotal: number;
  benchmarks: {
    platform: Platform | null;
    spend: number | null;
    cpm: number | null;
    ctr: number | null;
    cvr: number | null;
    roas: number | null;
    aov: number | null;
    funnel: {
      voc: number | null;
      atcRate: number | null;
      apRate: number | null;
      purchaseRate: number | null;
      cvr: number | null;
      ctr: number | null;
      cpm: number | null;
    };
  };
  budget: {
    month: string;
    planMode: string;
    bucket: string;
    platform: Platform | null;
    plan: number | null;
    /** Planned through the platform's coverage day — the Budget anchor. */
    expectedAtCoverage: number | null;
    actual: number | null;
    coverageDay: number | null;
    totalDays: number;
  } | null;
  conventions: {
    usdToSarRate: number;
    minSpendToJudge: number;
    goodRoas: number;
    decentRoas: number;
  };
}

// ── Output (the bundle) ─────────────────────────────────────────────────────

export interface DiagnosisWeek {
  weekStart: string;
  days: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number | null;
  cvr: number | null;
  roas: number | null;
}

export interface DiagnosisBundle {
  meta: DiagnosisInput["campaign"] & {
    brand: string;
    generatedAt: string;
    window: DiagnosisInput["window"];
    excludedRecords: "hidden" | "included";
    coverage: Record<string, string | null>;
  };
  series: {
    daily: Array<Record<string, number | null | string>>;
    weeklyBefore: DiagnosisWeek[];
    weeklyTruncated: boolean;
    lifetime: Record<string, number | null>;
  };
  creatives: {
    rows: DiagnosisCreativeInput[];
    total: number;
    truncated: boolean;
    note?: string;
  };
  benchmarks: DiagnosisInput["benchmarks"] & { campaignShareOfPlatformSpend: number | null };
  budget: DiagnosisInput["budget"];
  conventions: string;
  instructions: string;
}

/** Round to 2dp, preserving null — the payload is read, not re-computed. */
function r2(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/**
 * A weighted ratio, the house way: component sums, null when undefined. Kept
 * to 6dp — a CTR of 1.09% against a benchmark of 1.13% is a real difference,
 * and rounding rates to 2 or 4 places would erase exactly the comparisons this
 * bundle exists to support.
 */
function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  const v = numerator / denominator;
  return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
}

/** The fields a platform never reports — NULL there, and never a zero. */
const PLATFORM_DEPENDENT: Array<{ key: keyof DiagnosisDayRow; field: InternalField }> = [
  { key: "landingPageViews", field: "landing_page_views" },
  { key: "addToCart", field: "add_to_cart" },
  { key: "addPayment", field: "add_payment" },
  { key: "videoViews2s", field: "video_views_2s" },
  { key: "videoViews25", field: "video_views_25" },
  { key: "videoViews50", field: "video_views_50" },
  { key: "videoViews75", field: "video_views_75" },
  { key: "videoViews100", field: "video_views_100" },
];

/**
 * THE NULL RULE. A platform that doesn't report a metric stores NULL, and the
 * day queries coalesce those sums to 0 for charting. A diagnosis must never
 * see that 0: "google had 0 landing-page views" is a false fact that leads
 * straight to a wrong conclusion about the funnel. So anything the campaign's
 * platform cannot report comes back as `null`, with the conventions block
 * naming the set.
 */
export function nullUnavailable<T extends Record<string, unknown>>(
  row: T,
  platform: Platform | null,
): T {
  if (!platform) return row;
  const out: Record<string, unknown> = { ...row };
  for (const { key, field } of PLATFORM_DEPENDENT) {
    if (isFieldUnavailableOn(field, platform)) out[key as string] = null;
  }
  return out as T;
}

/** The Sunday-start week a date belongs to (the house's week convention). */
function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/**
 * Roll pre-window days into weeks — the trend a diagnosis needs without the
 * token cost of six months of dailies. Ratios are recomputed from the week's
 * component sums (never averaged from the days), which is the same weighted
 * rule every aggregate in this system follows.
 */
export function weeklyRollup(
  days: readonly DiagnosisDayRow[],
  cap = MAX_DIAGNOSIS_WEEKS,
): { weeks: DiagnosisWeek[]; truncated: boolean } {
  const byWeek = new Map<string, DiagnosisWeek>();
  for (const d of days) {
    const key = weekStartOf(d.date);
    const w = byWeek.get(key) ?? {
      weekStart: key,
      days: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      ctr: null,
      cvr: null,
      roas: null,
    };
    w.days += 1;
    w.spend += d.spend;
    w.impressions += d.impressions;
    w.clicks += d.clicks;
    w.conversions += d.conversions;
    w.revenue += d.conversionValue;
    byWeek.set(key, w);
  }
  const all = [...byWeek.values()]
    .map((w) => ({
      ...w,
      spend: r2(w.spend) ?? 0,
      revenue: r2(w.revenue) ?? 0,
      ctr: ratio(w.clicks, w.impressions),
      cvr: ratio(w.conversions, w.clicks),
      roas: ratio(w.revenue, w.spend),
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  if (all.length <= cap) return { weeks: all, truncated: false };
  // Keep the MOST RECENT weeks: the question is "what changed lately".
  return { weeks: all.slice(all.length - cap), truncated: true };
}

export interface ConventionsInput {
  rate: number;
  minSpendToJudge: number;
  goodRoas: number;
  decentRoas: number;
  platform: Platform | null;
  coverage: Record<string, string | null>;
  excludedRecords: "hidden" | "included";
}

/**
 * The conventions block — what every number in the bundle MEANS. It is
 * authored prose rather than a schema because its job is to stop a confident
 * model from reading a house convention as a general truth: a weighted ratio
 * is not an average, a NULL is not a zero, and a $0 day is not an idle day.
 */
export function diagnosisConventions(i: ConventionsInput): string {
  const unavailable = i.platform
    ? PLATFORM_DEPENDENT.filter((f) => isFieldUnavailableOn(f.field, i.platform!)).map(
        (f) => f.key,
      )
    : [];
  const coverageLines = Object.entries(i.coverage)
    .map(([p, d]) => `${p}: ${d ?? "no data"}`)
    .join("; ");
  return [
    "HOW TO READ THESE NUMBERS (house conventions — do not substitute your own):",
    "· Money is USD unless a field says SAR. Dates are YYYY-MM-DD.",
    `· The brand's USD→SAR rate is ${i.rate}. Revenue figures sourced from the store are SAR; ad-platform revenue is USD.`,
    "· Every blended metric (CTR, CvR, ROAS, CPA, CPM, VOC, hook/hold/complete) is WEIGHTED — component sums divided by component sums, never the mean of per-row ratios. Do not average the daily ratios to get a period ratio; recompute from the sums.",
    "· ROAS is written with a × suffix (e.g. 2.4×). The brand's recorded ROAS basis: RAW spend including Awareness campaigns (no exclusion filter), against Salla order totals AFTER discounts.",
    `· A ratio with no denominator is null, not 0 — render it as "—". A metric a platform does not report is null, NOT zero.${unavailable.length ? ` This campaign runs on ${i.platform}, which does not report: ${unavailable.join(", ")}. Those fields are null throughout this bundle; do not infer a funnel from them.` : ""}`,
    "· A daily row with `records: 0` is a day with NO uploaded rows — a gap, not a measured zero. Spend of 0 on a day that HAS records is a real zero.",
    `· Records marked excluded-from-aggregates are ${i.excludedRecords} in these numbers.`,
    `· COVERAGE — the latest uploaded day per platform: ${coverageLines || "none"}. Nothing after a platform's coverage date is missing data rather than zero; never read the gap between coverage and today as a drop. Budget pacing in this bundle is measured THROUGH the coverage day, not through today.`,
    `· JUDGING A CREATIVE: the brand's configured minimum spend to rate a creative is $${i.minSpendToJudge}. Below it, say "too small to judge" — do not call it a winner or a loser. The brand's rating thresholds are ${i.goodRoas}× (good) and ${i.decentRoas}× (decent).`,
    "· Funnel definitions: VOC = landing-page views ÷ clicks; CvR = conversions ÷ landing-page views; ATC rate = add-to-cart ÷ landing-page views; AP rate = add-payment ÷ add-to-cart; purchase rate = conversions ÷ add-payment. Hook = 2s views ÷ impressions; hold = 50% ÷ 2s; complete = 100% ÷ 2s.",
    "· Status vocabulary: new · active · pause · terminated. It is DERIVED from recent spend, never typed by a person.",
    "",
    "WHAT THIS SYSTEM DOES NOT HAVE (do not invent it, and do not infer it):",
    "· REACH AND FREQUENCY ARE NOT TRACKED. They are not in this bundle and cannot be derived from it. You must ASK THE USER for them before concluding anything about fatigue or saturation.",
    "· Store/UTM attribution is PLATFORM-level, not campaign-level: there is no store-order attribution for an individual campaign. Do not attribute store revenue to this campaign.",
    "· There is no audience, placement, device, geography or creative-asset (thumbnail/copy) data here.",
    "· There is no competitor or market data, and no pre-period benchmark beyond what this bundle carries.",
  ].join("\n");
}

/**
 * THE INSTRUCTIONS. This constant is the deliverable: the bundle is only as
 * useful as the discipline the reading model applies to it. Pinned by tests,
 * because a careless edit here degrades every diagnosis silently.
 */
export const DIAGNOSIS_INSTRUCTIONS = [
  "YOU ARE: a senior performance-marketing analyst for a Saudi e-commerce brand, reading one campaign's full diagnostic bundle. Write for the person who owns the budget: direct, numerate, no filler.",
  "",
  "1. THE INTERVIEW RULE — ASK WHERE IT MATTERS, DO NOT BLOCK THE REPORT.",
  "DELIVER EVERY SECTION THE BUNDLE CAN ALREADY ANSWER. Do not hold the whole report hostage to one missing input: most of a diagnosis does not depend on it, and a reader who gets nothing until they fetch a number gets nothing.",
  "Where a specific conclusion GENUINELY NEEDS data this system does not have, ask for it AT THAT POINT — in the section that needs it — mark that section \"PENDING YOUR DATA\" with the one question you need answered, and continue with the rest. Any fatigue or saturation call needs REACH and FREQUENCY for this campaign (any period and granularity the user can paste out of Ads Manager); this system does not track them, so that call is pending until they arrive. Ask the same way for anything else material: recent creative or landing-page changes, offers or promotions in the window, budget or bid changes, stock-outs, seasonality.",
  "Ask for the few things that matter, in the place they matter, and never as an upfront questionnaire. When the user answers, COMPLETE the pending section and reissue the report. If they decline or do not have it, say so in Fine print and MARK every conclusion that depends on the gap as resting on an assumption. A right diagnosis still outranks a fast one — what changed is the SCOPE of the wait, not the standard: the parts you can stand behind ship now, the part you cannot stays visibly unfinished.",
  "",
  "2. THE EVIDENCE RULE.",
  "Every claim cites numbers that are in this bundle verbatim, or that the user gave you. Never invent a figure, never estimate one you were not given, and never compare to an absolute notion of 'good': compare to the BENCHMARKS block (this brand, same platform, same window) and to the campaign's own history in the weekly series. If a creative's spend is below the minimum-spend threshold in the conventions, it is 'too small to judge' — say so instead of ranking it. Where a platform does not report a metric, say the metric is unavailable on that platform; do not treat null as zero.",
  "",
  "3. THE REPORT CONTRACT — these sections, in this order:",
  "   a. VERDICT — a severity (healthy / watch / problem / critical), ONE sentence saying what is going on, and the THREE numbers that justify it.",
  "   b. DO THIS — 2 to 4 concrete actions, each with its expected impact and your confidence (high/medium/low). Order them by impact. No generic advice; each action must follow from a number above.",
  "   c. CREATIVE CARDS — one per creative that matters, each labelled winner / fatigued / dead weight / too small to judge, with the evidence for the label (spend, ROAS vs benchmark, the 14-day trend, status).",
  "   d. FUNNEL VS BENCHMARK — stage by stage against the brand's same-platform averages, naming which stage is the leak. Say explicitly when a stage is unavailable on this platform.",
  "   e. BUDGET CONTEXT — this campaign's bucket against its plan, measured at the coverage day, and what the pace implies for the rest of the month.",
  "   f. FINE PRINT — data coverage dates, whether excluded records were counted, every assumption you made, and anything you asked for and did not get.",
  "",
  "4. THE ARTIFACT RULE — NOT OPTIONAL.",
  "YOUR FINAL REPORT MUST BE CREATED AS AN ARTIFACT: ONE self-contained HTML document, made with your artifact capability. NEVER deliver the report as chat text, and NEVER as markdown tables in the conversation. If you find yourself about to write the verdict or a table into chat, stop and put it in the artifact instead.",
  "IN CHAT, write AT MOST ONE SENTENCE pointing to the artifact. Nothing else.",
  "WHEN THE USER LATER SUPPLIES DATA YOU ASKED FOR, UPDATE THE ARTIFACT — or issue a v2 artifact — rather than answering in chat tables. The artifact is the living document; the conversation is not.",
  "LAYOUT, in exactly the section order above: a severity-toned verdict banner at the top, numbered action items, a responsive grid of creative cards, simple CSS bars for the funnel comparison, and muted fine print at the end. Any section still waiting on the user is marked \"PENDING YOUR DATA\" in place, with the question visible — never silently omitted. It must be readable in both light and dark (use a neutral surface and inherit-friendly colours), work at phone width, and need no network, no build step and no external assets. Format money as SAR/USD per the conventions and ROAS with a × suffix. The artifact IS the deliverable.",
  "",
  "5. LANGUAGE: write the report in English, including the artifact. Switch only if the user asks you to.",
].join("\n");

/**
 * Assemble the bundle. PURE: everything it needs is in `input`, so the same
 * function serves the MCP tool today and an in-system page later.
 */
export function serializeDiagnosis(input: DiagnosisInput): DiagnosisBundle {
  const platform = input.campaign.platform;
  const windowStart = input.window.from;

  const inWindow = input.days.filter((d) => d.date >= windowStart);
  const before = input.days.filter((d) => d.date < windowStart);
  const { weeks, truncated: weeklyTruncated } = weeklyRollup(before);

  const daily = inWindow.map((d) => {
    const row = {
      date: d.date,
      records: d.records,
      spend: r2(d.spend),
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
      revenue: r2(d.conversionValue),
      landingPageViews: d.landingPageViews,
      addToCart: d.addToCart,
      addPayment: d.addPayment,
      videoViews2s: d.videoViews2s,
      videoViews25: d.videoViews25,
      videoViews50: d.videoViews50,
      videoViews75: d.videoViews75,
      videoViews100: d.videoViews100,
      ctr: ratio(d.clicks, d.impressions),
      cvr: ratio(d.conversions, d.clicks),
      roas: ratio(d.conversionValue, d.spend),
      cpa: d.conversions ? r2(d.spend / d.conversions) : null,
    };
    return nullUnavailable(row, platform) as Record<string, number | null | string>;
  });

  const ranked = [...input.creatives].sort(
    (a, b) => b.inCampaign.spend - a.inCampaign.spend,
  );
  const shown = ranked.slice(0, MAX_DIAGNOSIS_CREATIVES);
  const truncated = ranked.length > MAX_DIAGNOSIS_CREATIVES;

  const campaignSpend = inWindow.reduce((s, d) => s + d.spend, 0);
  const share =
    input.benchmarks.spend && input.benchmarks.spend > 0
      ? ratio(campaignSpend, input.benchmarks.spend)
      : null;

  return {
    meta: {
      ...input.campaign,
      brand: input.brand.name,
      generatedAt: input.generatedAt,
      window: input.window,
      excludedRecords: input.excludedRecords,
      coverage: Object.fromEntries(
        Object.entries(input.coverage).map(([p, d]) => [p, d ?? null]),
      ),
    },
    series: {
      daily,
      weeklyBefore: weeks,
      weeklyTruncated,
      lifetime: input.lifetime,
    },
    creatives: {
      rows: shown,
      total: ranked.length,
      truncated,
      ...(truncated
        ? {
            note: `Showing the top ${MAX_DIAGNOSIS_CREATIVES} creatives by spend in this campaign, of ${ranked.length}. The rest are smaller than every one shown.`,
          }
        : {}),
    },
    benchmarks: { ...input.benchmarks, campaignShareOfPlatformSpend: share },
    budget: input.budget,
    conventions: diagnosisConventions({
      rate: input.conventions.usdToSarRate,
      minSpendToJudge: input.conventions.minSpendToJudge,
      goodRoas: input.conventions.goodRoas,
      decentRoas: input.conventions.decentRoas,
      platform,
      coverage: Object.fromEntries(
        Object.entries(input.coverage).map(([p, d]) => [p, d ?? null]),
      ),
      excludedRecords: input.excludedRecords,
    }),
    instructions: DIAGNOSIS_INSTRUCTIONS,
  };
}
