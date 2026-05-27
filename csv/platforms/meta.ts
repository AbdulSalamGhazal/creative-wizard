/**
 * Meta (Facebook / Instagram Ads) CSV adapter.
 *
 * **Placeholder schema** — final column names will be re-tuned from a real
 * Ads-Manager export. See docs/validation-spec.md §9.1.
 *
 * Quirks documented for the pipeline:
 *  - Header matching is case-insensitive and whitespace-trimmed.
 *  - Unknown extra columns are ignored (W002).
 *  - Subtotal row at the bottom: skipped if both `creative_name` and `date`
 *    are empty/missing.
 *  - Currency-suffixed amounts (`"$1,234"`, `"1234 USD"`) are accepted; the
 *    numeric parser strips commas and trailing letters.
 *  - Accepted date formats: ISO `YYYY-MM-DD`, US `MM/DD/YYYY`, and Meta's
 *    `D Mon YYYY` (e.g. `27 May 2026`).
 */
import type { PlatformAdapter } from "@/csv/platforms/types";

export const metaAdapter: PlatformAdapter = {
  platform: "meta",
  headerMap: {
    creative_name: ["Ad name", "Creative", "Ad"],
    date: ["Day", "Date"],
    spend: ["Amount spent (USD)", "Amount spent", "Spend"],
    impressions: ["Impressions"],
    clicks: ["Link clicks", "Clicks (all)", "Clicks"],
    conversions: ["Results", "Conversions"],
    conversion_value: ["Purchase value", "Conversion value"],
    video_views_3s: ["3-second video plays", "3-sec video views"],
    video_views_15s: ["ThruPlays", "15-second video plays"],
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
  acceptedDateFormats: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "D Mon YYYY"],
  skipRow: (row) =>
    (row.creative_name ?? "").trim() === "" &&
    (row.date ?? "").trim() === "",
};

export default metaAdapter;
