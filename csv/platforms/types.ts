/**
 * Shared platform-adapter interface. Each `csv/platforms/<name>.ts` exports a
 * `PlatformAdapter` so the pipeline can be platform-agnostic.
 */

export type InternalField =
  | "creative_name"
  | "date"
  | "spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "conversion_value"
  | "video_views_3s"
  | "video_views_15s";

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "D Mon YYYY" | "DD/MM/YYYY";

export interface PlatformAdapter {
  platform: "meta" | "tiktok" | "snapchat" | "google";
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
