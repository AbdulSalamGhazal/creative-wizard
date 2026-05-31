/**
 * Instagram (Meta Ads Manager export) CSV adapter.
 *
 * Instagram and Facebook are separate platforms but come from the same Meta
 * Ads Manager export format, so they share the header map / required fields /
 * date formats below (also re-used by `facebook.ts`). The user picks which
 * platform a given file is at upload time.
 *
 * Quirks:
 *  - Header matching is case-insensitive and whitespace-trimmed.
 *  - Unknown extra columns are ignored (W002).
 *  - Subtotal row at the bottom is skipped when creative_name and date are both
 *    empty.
 *  - Campaign Name + Ad Set Name are combined into a single stored value.
 *  - Header candidates are sensible defaults; admins can re-map them in
 *    Configuration → CSV mapping.
 */
import type {
  DateFormat,
  InternalField,
  PlatformAdapter,
} from "@/csv/platforms/types";

export const META_HEADER_MAP: Record<InternalField, string[]> = {
  creative_name: ["Ad name", "Creative", "Ad"],
  campaign_name: ["Campaign name", "Campaign"],
  adset_name: ["Ad set name", "Adset name", "Ad Set Name"],
  date: ["Day", "Date"],
  spend: ["Amount spent (USD)", "Amount spent", "Spend"],
  impressions: ["Impressions"],
  clicks: ["Link clicks", "Clicks (all)", "Clicks"],
  conversions: ["Results", "Conversions"],
  conversion_value: ["Purchase value", "Conversion value"],
  landing_page_views: ["Landing page views", "LP views"],
  video_views_2s: ["2-second continuous video plays", "2-second video views", "Video plays at 2s"],
  video_views_25: ["Video plays at 25%", "25% video views"],
  video_views_50: ["Video plays at 50%", "50% video views"],
  video_views_75: ["Video plays at 75%", "75% video views"],
  video_views_100: ["Video plays at 100%", "100% video views", "Video completions"],
};

export const META_REQUIRED_FIELDS: InternalField[] = [
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

export const META_DATE_FORMATS: DateFormat[] = [
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "D Mon YYYY",
];

export const metaSkipRow = (row: Partial<Record<InternalField, string>>): boolean =>
  (row.creative_name ?? "").trim() === "" && (row.date ?? "").trim() === "";

export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",
  headerMap: META_HEADER_MAP,
  requiredFields: META_REQUIRED_FIELDS,
  acceptedDateFormats: META_DATE_FORMATS,
  skipRow: metaSkipRow,
};

export default instagramAdapter;
