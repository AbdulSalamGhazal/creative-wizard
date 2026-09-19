/**
 * Shared platform-adapter interface. Each `csv/platforms/<name>.ts` exports a
 * `PlatformAdapter` so the pipeline can be platform-agnostic.
 */
import { ALL_PLATFORMS } from "@/lib/palette";

/** Derived from the canonical list — never re-list the platforms here. */
export type Platform = (typeof ALL_PLATFORMS)[number];

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
  /**
   * Platforms whose exports simply DO NOT CARRY this metric. This is the ONE
   * declaration of that fact, and three separate behaviours derive from it:
   *   1. the E010 required-column check SKIPS the field for those platforms
   *      (an absent column is expected, not a broken file);
   *   2. the pipeline writes **NULL, not 0** for it — the platform never
   *      measured this, which is not the same as measuring zero;
   *   3. `lib/metrics.ts` excludes those platforms from BOTH SIDES of any
   *      blended ratio that touches the field, so a platform that reports the
   *      numerator but not the denominator (or vice versa) can't poison it.
   * Never hand-list these platforms at a consumer — derive from here.
   */
  unavailableOn?: readonly Platform[];
}

/**
 * Google Ads exports carry spend/impressions/clicks/conversions/value and
 * nothing else this app models: no landing-page views, no cart or payment
 * events, and no video-view funnel at all.
 */
const GOOGLE_ONLY: readonly Platform[] = ["google"];

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
  landing_page_views: { label: "Landing page views", required: true, unavailableOn: GOOGLE_ONLY },
  add_to_cart: { label: "Add to cart (ATC)", required: false, unavailableOn: GOOGLE_ONLY },
  add_payment: { label: "Add payment (AP)", required: false, unavailableOn: GOOGLE_ONLY },
  video_views_2s: { label: "Video views 2s", required: true, unavailableOn: GOOGLE_ONLY },
  video_views_25: { label: "Video views 25%", required: true, unavailableOn: GOOGLE_ONLY },
  video_views_50: { label: "Video views 50%", required: true, unavailableOn: GOOGLE_ONLY },
  video_views_75: { label: "Video views 75%", required: true, unavailableOn: GOOGLE_ONLY },
  video_views_100: { label: "Video views 100%", required: true, unavailableOn: GOOGLE_ONLY },
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

/** True when `platform` cannot report `field` at all (see `unavailableOn`). */
export function isFieldUnavailableOn(
  field: InternalField,
  platform: Platform,
): boolean {
  return FIELD_META[field].unavailableOn?.includes(platform) ?? false;
}

/** Every field this platform's exports cannot carry, in INTERNAL_FIELDS order. */
export function unavailableFieldsFor(
  platform: Platform,
): readonly InternalField[] {
  return INTERNAL_FIELDS.filter((f) => isFieldUnavailableOn(f, platform));
}

/**
 * The platforms that cannot report ANY of `fields` — the set a blended ratio
 * over those fields has to exclude. Empty when every platform reports them all.
 */
export function platformsMissingAnyOf(
  fields: readonly InternalField[],
): readonly Platform[] {
  return ALL_PLATFORMS.filter((p) => fields.some((f) => isFieldUnavailableOn(f, p)));
}

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "D Mon YYYY" | "DD/MM/YYYY";

export interface PlatformAdapter {
  platform: Platform;
  /**
   * Map internal field names → candidate header strings (case-insensitive,
   * whitespace-trimmed match). The pipeline picks the first candidate that
   * appears in the CSV header row.
   */
  headerMap: Record<InternalField, string[]>;
  /**
   * Internal fields that must be present in the header row. Two things excuse
   * an absent column: the field is `unavailableOn` this platform, or the
   * adapter can `synthesizeAbsent` a value for it.
   */
  requiredFields: InternalField[];
  /**
   * Value to substitute when a field's COLUMN IS ABSENT from the file — for
   * exports that genuinely don't have the column (Google has no creative
   * column, and no ad-group column on campaign-level exports). A column that
   * IS present but blank is untouched by this: that stays an E042 blank
   * identity field, exactly as on every other platform.
   */
  synthesizeAbsent?: Partial<Record<InternalField, string>>;
  /** Accepted date formats; the pipeline tries each in order. */
  acceptedDateFormats: DateFormat[];
  /** Return true to silently skip a row (e.g. subtotal/grand-total rows). */
  skipRow?: (row: Partial<Record<InternalField, string>>) => boolean;
}
