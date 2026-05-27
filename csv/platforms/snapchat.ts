/**
 * Snapchat Ads CSV adapter.
 * **Placeholder schema** — to be tuned from a real export. See validation-spec §9.3.
 */
import type { PlatformAdapter } from "@/csv/platforms/types";

export const snapchatAdapter: PlatformAdapter = {
  platform: "snapchat",
  headerMap: {
    creative_name: ["Creative", "Ad name"],
    date: ["Date", "Day"],
    spend: ["Spend (USD)", "Spend"],
    impressions: ["Impressions"],
    clicks: ["Swipe Ups", "Clicks"],
    conversions: ["Total Conversions", "Conversions"],
    conversion_value: ["Total Conversion Value", "Conversion value"],
    video_views_3s: ["Video Views 3s"],
    video_views_15s: ["Video Views 15s"],
  },
  requiredFields: [
    "creative_name",
    "date",
    "spend",
    "impressions",
    "clicks",
    "conversions",
    "conversion_value",
    "video_views_3s",
    "video_views_15s",
  ],
  acceptedDateFormats: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"],
  skipRow: (row) =>
    (row.creative_name ?? "").trim() === "" && (row.date ?? "").trim() === "",
};

export default snapchatAdapter;
