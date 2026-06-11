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
  "add_to_cart",
  "add_payment",
  "video_views_2s",
  "video_views_25",
  "video_views_50",
  "video_views_75",
  "video_views_100",
] as const;

export type InternalField = (typeof INTERNAL_FIELDS)[number];

/**
 * Display metadata for each internal field: its human label and whether a
 * header mapping is required for an upload to validate.
 *
 * This is the ONLY place field labels / required-ness are declared. Because
 * it's a `Record<InternalField, …>`, the compiler forces an entry for every
 * field in INTERNAL_FIELDS — add a field above without describing it here and
 * the build fails. The CSV-mapping admin rows, the add-header dropdown, and
 * the platforms-readiness card all derive from this (via FIELD_LIST), so they
 * can never silently drift out of sync again.
 */
export interface FieldMeta {
  label: string;
  required: boolean;
}

export const FIELD_META: Record<InternalField, FieldMeta> = {
  creative_name: { label: "Creative name", required: true },
  campaign_name: { label: "Campaign name", required: true },
  adset_name: { label: "Ad set name", required: true },
  date: { label: "Date", required: true },
  spend: { label: "Spend", required: true },
  impressions: { label: "Impressions", required: true },
  clicks: { label: "Clicks", required: true },
  conversions: { label: "Conversions", required: true },
  conversion_value: { label: "Conversion value", required: true },
  landing_page_views: { label: "Landing page views", required: true },
  add_to_cart: { label: "Add to cart (ATC)", required: false },
  add_payment: { label: "Add payment (AP)", required: false },
  video_views_2s: { label: "Video views 2s", required: true },
  video_views_25: { label: "Video views 25%", required: true },
  video_views_50: { label: "Video views 50%", required: true },
  video_views_75: { label: "Video views 75%", required: true },
  video_views_100: { label: "Video views 100%", required: true },
};

/**
 * Ordered `[{ key, label, required }]` for UI iteration — display order follows
 * INTERNAL_FIELDS. Always derive UI field lists from this; never hand-copy.
 */
export const FIELD_LIST: ReadonlyArray<{
  key: InternalField;
  label: string;
  required: boolean;
}> = INTERNAL_FIELDS.map((key) => ({ key, ...FIELD_META[key] }));

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "D Mon YYYY" | "DD/MM/YYYY";

export interface PlatformAdapter {
  platform: "instagram" | "facebook" | "tiktok" | "snapchat";
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
