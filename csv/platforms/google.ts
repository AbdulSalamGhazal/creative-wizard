/**
 * Google Ads CSV adapter.
 *
 * Google is the STANDARD pipeline (2026-09-20, a user decision that superseded
 * the original system-creative design): the export names its creative and its
 * ad group like every other platform's does, and the ordinary identity rules
 * apply — a missing column is E010, a blank identity cell E042, an unregistered
 * creative E020. There is no google-specific copy and no google-specific
 * creative machinery; the team prepares the two columns in the export and owns
 * whatever creative(s) those rows name.
 *
 * What IS google-specific is its DATA SHAPE: no landing-page views, no cart or
 * payment events, no video funnel. Those fields are declared
 * `unavailableOn: ["google"]` in `csv/platforms/types.ts`, which excuses the
 * missing columns (no E010) and makes the pipeline store NULL rather than 0 —
 * and `lib/metrics.ts` derives its ratio guard from the same declaration.
 *
 * Headers are ASSUMED (Google's export lets you rename columns); admins fix
 * them per account in Upload ads → CSV mapping like every other platform.
 */
import {
  unavailableFieldsFor,
  type InternalField,
  type PlatformAdapter,
} from "@/csv/platforms/types";

const UNAVAILABLE = new Set<InternalField>(unavailableFieldsFor("google"));

/**
 * Everything google CAN report is required, derived from the unavailability
 * declaration so the two can never disagree.
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
    creative_name: ["Creative", "Creative name"],
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
