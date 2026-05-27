/**
 * TikTok Ads CSV adapter.
 * **Placeholder schema** — to be tuned from a real export. See validation-spec §9.2.
 */
import type { PlatformAdapter } from "@/csv/platforms/types";

export const tiktokAdapter: PlatformAdapter = {
  platform: "tiktok",
  headerMap: {
    creative_name: ["Ad name", "Creative name", "Ad"],
    date: ["Date", "By day"],
    spend: ["Cost (USD)", "Spend", "Cost"],
    impressions: ["Impressions", "Impression"],
    clicks: ["Clicks", "CTR (link click)"],
    conversions: ["Conversions", "Total complete payment"],
    conversion_value: ["Total complete payment value", "Conversion value"],
    video_views_3s: ["3-second video views"],
    video_views_15s: ["6-second video views", "Video plays at 100%"],
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

export default tiktokAdapter;
