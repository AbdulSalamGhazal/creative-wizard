/**
 * Google Ads CSV adapter.
 *
 * Two things make google different from the social adapters, both declared
 * rather than special-cased in the pipeline:
 *
 * 1. **No creative column.** Google reports campaigns/ad groups, not creative
 *    names, so every row is stamped with the ONE system creative
 *    (`GOOGLE_SYSTEM_CREATIVE_NAME`) through `synthesizeAbsent`. The pipeline's
 *    normal trim-then-exact matching then resolves it like any other name —
 *    `ensureGoogleCreative` guarantees the row exists before matching runs.
 * 2. **Thinner metrics.** No landing-page views, no cart/payment events, no
 *    video funnel: those fields are declared `unavailableOn: ["google"]` in
 *    `csv/platforms/types.ts`, which excuses the missing columns (no E010) and
 *    makes the pipeline store NULL instead of 0.
 *
 * Headers are ASSUMED (Google's export lets you rename columns); admins fix
 * them per account in Upload ads → CSV mapping like every other platform.
 */
import { GOOGLE_ADSET_FALLBACK, GOOGLE_SYSTEM_CREATIVE_NAME } from "@/lib/google";
import {
  unavailableFieldsFor,
  type InternalField,
  type PlatformAdapter,
} from "@/csv/platforms/types";

const UNAVAILABLE = new Set<InternalField>(unavailableFieldsFor("google"));

/**
 * Everything google CAN report is required, derived from the unavailability
 * declaration so the two can never disagree. `creative_name` and `adset_name`
 * stay in the list — they're satisfied by `synthesizeAbsent` when the column
 * is missing, and still enforced when it's there.
 */
const REQUIRED: InternalField[] = [
  "creative_name",
  "campaign_name",
  "adset_name",
  "date",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversion_value",
].filter((f) => !UNAVAILABLE.has(f as InternalField)) as InternalField[];

export const googleAdapter: PlatformAdapter = {
  platform: "google",
  headerMap: {
    // No such column in any google export — synthesized below.
    creative_name: [],
    campaign_name: ["Campaign"],
    adset_name: ["Ad group", "Ad group name"],
    date: ["Day", "Date"],
    spend: ["Cost"],
    impressions: ["Impressions"],
    clicks: ["Clicks"],
    conversions: ["Conversions"],
    conversion_value: ["Conv. value", "Total conv. value"],
    // Not reported by google — see UNAVAILABLE above.
    landing_page_views: [],
    add_to_cart: [],
    add_payment: [],
    video_views_2s: [],
    video_views_25: [],
    video_views_50: [],
    video_views_75: [],
    video_views_100: [],
  },
  requiredFields: REQUIRED,
  synthesizeAbsent: {
    creative_name: GOOGLE_SYSTEM_CREATIVE_NAME,
    adset_name: GOOGLE_ADSET_FALLBACK,
  },
  acceptedDateFormats: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"],
  skipRow: (row) => {
    // Google exports end with summary rows whose FIRST column reads
    // "Total: all campaigns" — skipped like the other adapters' subtotals. A
    // genuinely blank date on a row with real content still errors (E042).
    const day = (row.date ?? "").trim().toLowerCase();
    if (day.startsWith("total")) return true;
    return day === "" && (row.campaign_name ?? "").trim() === "";
  },
};

export default googleAdapter;
