/**
 * Platform colors, as references to the CSS vars in app/globals.css so they
 * follow the active theme. Recharts and inline `style` both resolve `var(…)`
 * at paint time (SVG fill/stroke and DOM background alike), so a single source
 * drives every swatch. The three light themes override `--tiktok` / `--snapchat`
 * (the two hues that fail on white) — see the light-theme block in globals.css.
 *
 * Meta was split into Instagram + Facebook — they are now two distinct
 * platforms everywhere in the system. (Google was removed — to re-add it,
 * restore it in `platformEnum` (db/schema.ts), these three maps, and the
 * `--google` CSS var in app/globals.css.)
 */
type PlatformKey = "instagram" | "facebook" | "tiktok" | "snapchat";

export const PLATFORM_COLOR: Record<PlatformKey, string> = {
  instagram: "var(--instagram)", // IG purple/magenta
  facebook: "var(--facebook)", // FB blue
  tiktok: "var(--tiktok)", // grey (dark on light themes)
  snapchat: "var(--snapchat)", // yellow (darker gold on light themes)
};

export const PLATFORM_LABEL: Record<PlatformKey, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  snapchat: "Snapchat",
};

export const ALL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "snapchat",
] as const;

/**
 * Deterministic gradient picker for creative thumbnails without an uploaded
 * image. Same `name` always returns the same pair so cards stay stable
 * across re-renders.
 */
const CARD_GRADIENTS: Array<{ from: string; to: string }> = [
  { from: "#3a1f47", to: "#7a1f54" }, // plum
  { from: "#1f2a47", to: "#2a4a7a" }, // indigo
  { from: "#2a1f47", to: "#5a2a7a" }, // violet
  { from: "#473a1f", to: "#7a5a1f" }, // amber
  { from: "#1f4737", to: "#1f7a5a" }, // emerald
  { from: "#47291f", to: "#7a4a1f" }, // copper
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function gradientFor(name: string): { from: string; to: string } {
  const idx = hashString(name) % CARD_GRADIENTS.length;
  return CARD_GRADIENTS[idx]!;
}

/**
 * Distinct palette for product slices in the product-mix donut. Same hash
 * trick as gradients, but flat colors that legibly contrast with the
 * platform palette (no blue/pink) so the two donuts read differently.
 * CSS-var references (theme-aware — darker on the light themes).
 */
const PRODUCT_COLORS = [
  "var(--product-1)", // violet
  "var(--product-2)", // pink
  "var(--product-3)", // amber
  "var(--product-4)", // emerald
  "var(--product-5)", // sky
  "var(--product-6)", // rose
  "var(--product-7)", // cyan
  "var(--product-8)", // lilac
];

export function productColor(name: string): string {
  return PRODUCT_COLORS[hashString(name) % PRODUCT_COLORS.length]!;
}

/** Deterministic flat color for an arbitrary label (e.g. tags). */
export function swatchColor(name: string): string {
  return PRODUCT_COLORS[hashString(name) % PRODUCT_COLORS.length]!;
}

/**
 * A 16-hue series palette, ordered so adjacent entries are far apart on the
 * wheel. Assign by RANK (not by name-hash) so the items in one set never
 * collide — the first ~12 are strongly distinct, the rest fill in for large
 * sets. Used for per-creative chart lines + KPI breakdown bars.
 */
const SERIES_COLORS = [
  "var(--series-1)", // blue
  "var(--series-2)", // pink
  "var(--series-3)", // emerald
  "var(--series-4)", // amber
  "var(--series-5)", // violet
  "var(--series-6)", // orange
  "var(--series-7)", // cyan
  "var(--series-8)", // red
  "var(--series-9)", // indigo
  "var(--series-10)", // green
  "var(--series-11)", // fuchsia
  "var(--series-12)", // teal
  "var(--series-13)", // light red
  "var(--series-14)", // sky
  "var(--series-15)", // lime
  "var(--series-16)", // purple
];

/** Color for the index-th item in an ordered set (cycles past 16). */
export function seriesColor(index: number): string {
  return SERIES_COLORS[((index % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length]!;
}

/** Fixed colors + labels for the three creative types. */
export const TYPE_COLOR: Record<"video" | "image" | "slides", string> = {
  video: "var(--type-video)", // sky
  image: "var(--type-image)", // amber
  slides: "var(--type-slides)", // violet
};
export const TYPE_LABEL: Record<"video" | "image" | "slides", string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};
