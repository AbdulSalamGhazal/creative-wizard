/**
 * Shared platform-adapter interface. Each `csv/platforms/<name>.ts` exports a
 * `PlatformAdapter` so the pipeline can be platform-agnostic.
 */

/**
 * Every internal field the CSV pipeline understands — the single source of
 * truth. The `InternalField` type and all runtime validation (Zod enums in
 * server actions, UI field pickers) derive from this array, so adding or
 * removing a field is a one-line change here that can never drift out of sync.
 */
export const INTERNAL_FIELDS = [
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
] as const;

export type InternalField = (typeof INTERNAL_FIELDS)[number];

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "D Mon YYYY" | "DD/MM/YYYY";

export interface PlatformAdapter {
  platform: "instagram" | "facebook" | "tiktok" | "snapchat" | "google";
  /**
   * Map internal field names → candidate header strings (case-insensitive,
   * whitespace-trimmed match). The pipeline picks the first candidate that
   * appears in the CSV header row.
   */
  headerMap: Record<InternalField, string[]>;
  /** Internal fields that must be present in the header row. */
  requiredFields: InternalField[];
  /** Accepted date formats; the pipeline tries each in order. */
  acceptedDateFormats: DateFormat[];
  /** Return true to silently skip a row (e.g. subtotal/grand-total rows). */
  skipRow?: (row: Partial<Record<InternalField, string>>) => boolean;
}
