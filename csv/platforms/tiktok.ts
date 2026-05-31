/**
 * TikTok Ads CSV adapter.
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

export const tiktokAdapter: PlatformAdapter = {
  platform: "tiktok",
  headerMap: {
    creative_name: ["Ad name", "Creative name", "Ad"],
    campaign_name: ["Campaign name", "Campaign"],
    adset_name: ["Ad group name", "Adgroup name", "Ad Group"],
    date: ["Date", "By day"],
    spend: ["Cost (USD)", "Spend", "Cost"],
    impressions: ["Impressions", "Impression"],
    clicks: ["Clicks", "Clicks (destination)"],
    conversions: ["Conversions", "Total complete payment"],
    conversion_value: ["Total complete payment value", "Conversion value"],
    landing_page_views: ["Landing page views", "Page views"],
    video_views_2s: ["2-second video views", "Video views at 2s"],
    video_views_25: ["Video views at 25%", "25% video views"],
    video_views_50: ["Video views at 50%", "50% video views"],
    video_views_75: ["Video views at 75%", "75% video views"],
    video_views_100: ["Video views at 100%", "100% video views"],
  },
  requiredFields: REQUIRED,
  acceptedDateFormats: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"],
  skipRow: (row) =>
    (row.creative_name ?? "").trim() === "" && (row.date ?? "").trim() === "",
};

export default tiktokAdapter;
