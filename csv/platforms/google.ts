/**
 * Google / YouTube Ads CSV adapter.
 * **Placeholder schema** — to be tuned from a real export. See validation-spec §9.4.
 */
import type { PlatformAdapter } from "@/csv/platforms/types";

export const googleAdapter: PlatformAdapter = {
  platform: "google",
  headerMap: {
    creative_name: ["Ad", "Ad name", "Creative"],
    date: ["Day", "Date"],
    spend: ["Cost", "Cost (USD)"],
    impressions: ["Impr.", "Impressions"],
    clicks: ["Clicks"],
    conversions: ["Conversions"],
    conversion_value: ["Conv. value", "Conversion value"],
    video_views_3s: ["Video views"],
    video_views_15s: ["Video plays at 100%", "Video views to 100%"],
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

export default googleAdapter;
