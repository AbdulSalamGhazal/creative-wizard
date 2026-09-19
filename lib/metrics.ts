import { sql, type Column, type SQL } from "drizzle-orm";
import { performanceRecords, type platformEnum } from "@/db/schema";
import {
  platformsMissingAnyOf,
  type InternalField,
} from "@/csv/platforms/types";

type Platform = (typeof platformEnum)[number];

/**
 * Canonical weighted-aggregation SQL fragments.
 *
 * Every blended/aggregated metric in the system is computed as a weighted
 * average via component sums — `SUM(numerator) / NULLIF(SUM(denominator), 0)` —
 * never as `AVG(per-row ratio)`. `NULLIF(divisor, 0)` keeps undefined results
 * as NULL so the UI renders an em-dash instead of zero or infinity.
 *
 * All aggregation queries import these fragments; never open-code the formulas.
 * See `docs/tech-spec.md` §8.2 and `docs/prd.md` §5.4.
 *
 * Rate-type metrics (ctr, voc, hook/hold/complete) are returned as raw ratios;
 * the UI multiplies by 100 and appends `%`. Cost metrics (cpm/cpc/cpa) are
 * dollar amounts; roas is a ×ratio.
 */

const p = performanceRecords;

/**
 * THE RATIO-POISONING GUARD.
 *
 * Some platforms don't report some metrics at all (Google has no landing-page
 * views, no cart/payment events, no video funnel — see `FIELD_META
 * .unavailableOn`, the one declaration this derives from). Their rows store
 * NULL there, and `SUM` skips NULLs — so a blended ratio would take its
 * NUMERATOR from every platform while its DENOMINATOR came from only some.
 * `purchaseRate = Σconversions / Σadd_payment` is the sharp case: google
 * contributes conversions it can't back with add-payments, and the blended
 * rate reads far higher than any real platform's.
 *
 * So: any fragment whose numerator OR denominator touches an unreported field
 * excludes those platforms from BOTH SIDES. The result is then a true rate for
 * the platforms that actually measure the funnel, and google simply isn't in
 * it. Ratios google fully supports (CTR, CPM, CPC, CPA, ROAS, AOV) and every
 * plain SUM include it normally.
 */
function ratioScope(...fields: InternalField[]): SQL | null {
  const missing = platformsMissingAnyOf(fields);
  if (missing.length === 0) return null;
  return sql`${p.platform} NOT IN (${sql.join(
    missing.map((m) => sql`${m}`),
    sql`, `,
  )})`;
}

/** `SUM(col)`, restricted to `scope` when one applies (and to `extra` if given). */
function scopedSum(col: Column, scope: SQL | null, extra?: SQL): SQL<number> {
  const filters = [scope, extra].filter((f): f is SQL => f !== null && f !== undefined);
  if (filters.length === 0) return sql<number>`SUM(${col})`;
  return sql<number>`SUM(${col}) FILTER (WHERE ${sql.join(filters, sql` AND `)})`;
}

// Scopes, derived once. Each names the fields its ratios touch.
const vocScope = ratioScope("landing_page_views", "clicks");
const cvrScope = ratioScope("conversions", "landing_page_views");
const atcScope = ratioScope("add_to_cart", "landing_page_views");
const apScope = ratioScope("add_payment", "add_to_cart");
const purchaseScope = ratioScope("conversions", "add_payment");
const hookScope = ratioScope("video_views_2s", "impressions");
const holdScope = ratioScope("video_views_50", "video_views_2s");
const completeScope = ratioScope("video_views_100", "video_views_2s");

/**
 * Video-funnel metrics ignore image/slides creatives. The upload pipeline
 * stores NULL video views for non-video creatives, so SUM() skips them in the
 * numerators automatically. For hookRate we also restrict the impressions
 * denominator to rows that actually carry video data
 * (`video_views_2s IS NOT NULL`), so non-video impressions don't dilute it.
 * This keeps the fragments self-contained — no `creatives` join required.
 */

export const sumSpend: SQL<number> = sql<number>`SUM(${p.spend})`;
export const sumImpressions: SQL<number> = sql<number>`SUM(${p.impressions})`;
export const sumClicks: SQL<number> = sql<number>`SUM(${p.clicks})`;
export const sumConversions: SQL<number> = sql<number>`SUM(${p.conversions})`;
export const sumConversionValue: SQL<number> = sql<number>`SUM(${p.conversionValue})`;
export const sumLandingPageViews: SQL<number> = sql<number>`SUM(${p.landingPageViews})`;
export const sumAddToCart: SQL<number> = sql<number>`SUM(${p.addToCart})`;
export const sumAddPayment: SQL<number> = sql<number>`SUM(${p.addPayment})`;
export const sumVideoViews2s: SQL<number> = sql<number>`SUM(${p.videoViews2s})`;
export const sumVideoViews25: SQL<number> = sql<number>`SUM(${p.videoViews25})`;
export const sumVideoViews50: SQL<number> = sql<number>`SUM(${p.videoViews50})`;
export const sumVideoViews75: SQL<number> = sql<number>`SUM(${p.videoViews75})`;
export const sumVideoViews100: SQL<number> = sql<number>`SUM(${p.videoViews100})`;

export const ctr: SQL<number> = sql<number>`SUM(${p.clicks})::numeric / NULLIF(SUM(${p.impressions}), 0)`;
export const cpm: SQL<number> = sql<number>`SUM(${p.spend}) / NULLIF(SUM(${p.impressions}), 0) * 1000`;
export const cpc: SQL<number> = sql<number>`SUM(${p.spend}) / NULLIF(SUM(${p.clicks}), 0)`;
export const cpa: SQL<number> = sql<number>`SUM(${p.spend}) / NULLIF(SUM(${p.conversions}), 0)`;
export const roas: SQL<number> = sql<number>`SUM(${p.conversionValue}) / NULLIF(SUM(${p.spend}), 0)`;
/** Average order value = revenue / orders. */
export const aov: SQL<number> = sql<number>`SUM(${p.conversionValue}) / NULLIF(SUM(${p.conversions}), 0)`;
/** Views Over Clicks = landing page views / clicks (shown ×100 as %). */
export const voc: SQL<number> = sql<number>`${scopedSum(p.landingPageViews, vocScope)}::numeric / NULLIF(${scopedSum(p.clicks, vocScope)}, 0)`;
/**
 * Conversion rate = conversions / landing page views (shown ×100 as %). The
 * last funnel step after VOC: impressions →(CTR)→ clicks →(VOC)→ LP views
 * →(CvR)→ conversions.
 */
export const cvr: SQL<number> = sql<number>`${scopedSum(p.conversions, cvrScope)}::numeric / NULLIF(${scopedSum(p.landingPageViews, cvrScope)}, 0)`;

/**
 * Lower-funnel step rates (shown ×100 as %). The funnel between LP view and
 * purchase: LP views →(atcRate)→ add-to-cart →(apRate)→ add-payment
 * →(purchaseRate)→ conversions.
 */
export const atcRate: SQL<number> = sql<number>`${scopedSum(p.addToCart, atcScope)}::numeric / NULLIF(${scopedSum(p.landingPageViews, atcScope)}, 0)`;
export const apRate: SQL<number> = sql<number>`${scopedSum(p.addPayment, apScope)}::numeric / NULLIF(${scopedSum(p.addToCart, apScope)}, 0)`;
export const purchaseRate: SQL<number> = sql<number>`${scopedSum(p.conversions, purchaseScope)}::numeric / NULLIF(${scopedSum(p.addPayment, purchaseScope)}, 0)`;

// Video-funnel rates — non-video rows carry NULL video views and so are
// skipped; hookRate's denominator is restricted to rows with video data.
export const hookRate: SQL<number> = sql<number>`${scopedSum(p.videoViews2s, hookScope)}::numeric / NULLIF(${scopedSum(p.impressions, hookScope, sql`${p.videoViews2s} IS NOT NULL`)}, 0)`;
export const holdRate: SQL<number> = sql<number>`${scopedSum(p.videoViews50, holdScope)}::numeric / NULLIF(${scopedSum(p.videoViews2s, holdScope)}, 0)`;
export const completeRate: SQL<number> = sql<number>`${scopedSum(p.videoViews100, completeScope)}::numeric / NULLIF(${scopedSum(p.videoViews2s, completeScope)}, 0)`;

/**
 * Per-platform metric fragments built on Postgres FILTER aggregates. Used by
 * the Summary view to compute every platform's columns side-by-side in a
 * single grouped query — one row per creative, columns per (platform, metric).
 *
 * The formulas are identical to the unfiltered exports above: weighted via
 * component sums, NULLIF on the divisor. The only difference is the FILTER
 * predicate that restricts each SUM to its specific platform. This is the
 * ONLY correct way to compute per-platform CTR/CPM/etc — never `AVG(ratio)`.
 *
 * For "blended across the selected platforms" totals, the caller's WHERE
 * clause already restricts the joined rows; the unfiltered fragments above
 * handle those correctly.
 */
export interface MetricBlockSql {
  spend: SQL<number>;
  impressions: SQL<number>;
  clicks: SQL<number>;
  conversions: SQL<number>;
  conversionValue: SQL<number>;
  landingPageViews: SQL<number>;
  videoViews2s: SQL<number>;
  videoViews25: SQL<number>;
  videoViews50: SQL<number>;
  videoViews75: SQL<number>;
  videoViews100: SQL<number>;
  ctr: SQL<number>;
  cpm: SQL<number>;
  cpc: SQL<number>;
  cpa: SQL<number>;
  roas: SQL<number>;
  voc: SQL<number>;
  cvr: SQL<number>;
  hookRate: SQL<number>;
  holdRate: SQL<number>;
  completeRate: SQL<number>;
}

/**
 * Build the full metric block restricted to the rows matching `predicate`
 * via Postgres FILTER aggregates. Component sums are filtered; derived
 * metrics are the canonical weighted ratios over those filtered sums —
 * never AVG of per-row ratios. Video rates additionally restrict to video
 * creatives, so callers must join `creatives`.
 */
export function scopedMetrics(predicate: SQL): MetricBlockSql {
  const w = predicate;
  const spend = sql<number>`SUM(${p.spend}) FILTER (WHERE ${w})`;
  const impressions = sql<number>`SUM(${p.impressions}) FILTER (WHERE ${w})`;
  const clicks = sql<number>`SUM(${p.clicks}) FILTER (WHERE ${w})`;
  const conversions = sql<number>`SUM(${p.conversions}) FILTER (WHERE ${w})`;
  const conversionValue = sql<number>`SUM(${p.conversionValue}) FILTER (WHERE ${w})`;
  const landingPageViews = sql<number>`SUM(${p.landingPageViews}) FILTER (WHERE ${w})`;
  const videoViews2s = sql<number>`SUM(${p.videoViews2s}) FILTER (WHERE ${w})`;
  const videoViews25 = sql<number>`SUM(${p.videoViews25}) FILTER (WHERE ${w})`;
  const videoViews50 = sql<number>`SUM(${p.videoViews50}) FILTER (WHERE ${w})`;
  const videoViews75 = sql<number>`SUM(${p.videoViews75}) FILTER (WHERE ${w})`;
  const videoViews100 = sql<number>`SUM(${p.videoViews100}) FILTER (WHERE ${w})`;
  // The exposed SUMS above stay unguarded — a plain total includes every
  // platform. Only the RATIOS below carry the poisoning guard, so each one
  // needs its own scoped pair of sums.
  const g = (col: Column, scope: SQL | null, extra?: SQL) =>
    scopedSum(col, scope === null ? w : sql`${w} AND ${scope}`, extra);
  // hookRate's denominator counts only rows with video data so non-video
  // impressions don't dilute it; the numerators already skip NULL video views.
  const imprVideo = g(p.impressions, hookScope, sql`${p.videoViews2s} IS NOT NULL`);
  return {
    spend,
    impressions,
    clicks,
    conversions,
    conversionValue,
    landingPageViews,
    videoViews2s,
    videoViews25,
    videoViews50,
    videoViews75,
    videoViews100,
    ctr: sql<number>`${clicks}::numeric / NULLIF(${impressions}, 0)`,
    cpm: sql<number>`${spend} / NULLIF(${impressions}, 0) * 1000`,
    cpc: sql<number>`${spend} / NULLIF(${clicks}, 0)`,
    cpa: sql<number>`${spend} / NULLIF(${conversions}, 0)`,
    roas: sql<number>`${conversionValue} / NULLIF(${spend}, 0)`,
    voc: sql<number>`${g(p.landingPageViews, vocScope)}::numeric / NULLIF(${g(p.clicks, vocScope)}, 0)`,
    cvr: sql<number>`${g(p.conversions, cvrScope)}::numeric / NULLIF(${g(p.landingPageViews, cvrScope)}, 0)`,
    hookRate: sql<number>`${g(p.videoViews2s, hookScope)}::numeric / NULLIF(${imprVideo}, 0)`,
    holdRate: sql<number>`${g(p.videoViews50, holdScope)}::numeric / NULLIF(${g(p.videoViews2s, holdScope)}, 0)`,
    completeRate: sql<number>`${g(p.videoViews100, completeScope)}::numeric / NULLIF(${g(p.videoViews2s, completeScope)}, 0)`,
  };
}

/** Per-platform metric block — a `scopedMetrics` over `platform = X`. */
export function platformMetrics(platform: Platform): MetricBlockSql {
  return scopedMetrics(sql`${p.platform} = ${platform}`);
}
