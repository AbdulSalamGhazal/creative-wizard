/**
 * Google / YouTube Ads CSV adapter.
 * **Placeholder headers** — admins can re-map them in Configuration → CSV mapping.
 */
import type { InternalField, PlatformAdapter } from "@/csv/platforms/types";

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
  "landing_page_views",
  "video_views_2s",
  "video_views_25",
  "video_views_50",
  "video_views_75",
  "video_views_100",
];

export const googleAdapter: PlatformAdapter = {
  platform: "google",
  headerMap: {
    creative_name: ["Ad", "Ad name", "Creative"],
    campaign_name: ["Campaign", "Campaign name"],
    adset_name: ["Ad group", "Ad group name"],
    date: ["Day", "Date"],
    spend: ["Cost", "Cost (USD)"],
    impressions: ["Impr.", "Impressions"],
    clicks: ["Clicks"],
    conversions: ["Conversions"],
    conversion_value: ["Conv. value", "Conversion value"],
    landing_page_views: ["Landing page views", "Page views"],
    // No built-in defaults — mapped only via Configuration → CSV mapping.
    add_to_cart: [],
    add_payment: [],
    video_views_2s: ["Video played to 2s", "Video views at 2s"],
    video_views_25: ["Video played to 25%", "25% video views"],
    video_views_50: ["Video played to 50%", "50% video views"],
    video_views_75: ["Video played to 75%", "75% video views"],
    video_views_100: ["Video played to 100%", "Video views to 100%"],
  },
  requiredFields: REQUIRED,
  acceptedDateFormats: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"],
  skipRow: (row) =>
    (row.creative_name ?? "").trim() === "" && (row.date ?? "").trim() === "",
};

export default googleAdapter;
