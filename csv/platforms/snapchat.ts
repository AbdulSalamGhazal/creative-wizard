/**
 * Snapchat Ads CSV adapter.
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

export const snapchatAdapter: PlatformAdapter = {
  platform: "snapchat",
  headerMap: {
    creative_name: ["Creative", "Ad name"],
    campaign_name: ["Campaign name", "Campaign"],
    adset_name: ["Ad Squad Name", "Ad squad", "Adset name"],
    date: ["Date", "Day"],
    spend: ["Spend (USD)", "Spend"],
    impressions: ["Impressions"],
    clicks: ["Swipe Ups", "Clicks"],
    conversions: ["Total Conversions", "Conversions"],
    conversion_value: ["Total Conversion Value", "Conversion value"],
    landing_page_views: ["Landing page views", "Page views"],
    // No built-in defaults — mapped only via Configuration → CSV mapping.
    add_to_cart: [],
    add_payment: [],
    video_views_2s: ["2s Video Views", "Video Views 2s"],
    video_views_25: ["Video Views 25%", "25% Video Views"],
    video_views_50: ["Video Views 50%", "50% Video Views"],
    video_views_75: ["Video Views 75%", "75% Video Views"],
    video_views_100: ["Video Views 100%", "100% Video Views"],
  },
  requiredFields: REQUIRED,
  acceptedDateFormats: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"],
  skipRow: (row) =>
    (row.creative_name ?? "").trim() === "" && (row.date ?? "").trim() === "",
};

export default snapchatAdapter;
