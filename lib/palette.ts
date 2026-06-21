/**
 * Hex mirrors of the platform colors defined in app/globals.css.
 * Recharts and other DOM-renderers need literal color values, not CSS vars.
 * Keep these in sync with `--instagram`, `--facebook`, `--tiktok`,
 * `--snapchat`.
 *
 * Meta was split into Instagram + Facebook — they are now two distinct
 * platforms everywhere in the system. (Google was removed — to re-add it,
 * restore it in `platformEnum` (db/schema.ts), these three maps, and the
 * `--google` CSS var in app/globals.css.)
 */
type PlatformKey = "instagram" | "facebook" | "tiktok" | "snapchat";

export const PLATFORM_COLOR: Record<PlatformKey, string> = {
  instagram: "#c13584", // IG purple/magenta
  facebook: "#4f8efb", // FB blue
  tiktok: "#d4d4d8", // light grey (distinct from IG pink)
  snapchat: "#ffd80b", // yellow
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
 */
const PRODUCT_COLORS = [
  "#A78BFA", // violet
  "#F472B6", // pink
  "#FBBF24", // amber
  "#34D399", // emerald
  "#60A5FA", // sky
  "#F87171", // rose
  "#22D3EE", // cyan
  "#C084FC", // lilac
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
  "#60A5FA", // blue
  "#F472B6", // pink
  "#34D399", // emerald
  "#FBBF24", // amber
  "#A78BFA", // violet
  "#FB923C", // orange
  "#22D3EE", // cyan
  "#F87171", // red
  "#818CF8", // indigo
  "#4ADE80", // green
  "#E879F9", // fuchsia
  "#2DD4BF", // teal
  "#FCA5A5", // light red
  "#38BDF8", // sky
  "#A3E635", // lime
  "#C084FC", // purple
];

/** Color for the index-th item in an ordered set (cycles past 16). */
export function seriesColor(index: number): string {
  return SERIES_COLORS[((index % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length]!;
}

/** Fixed colors + labels for the three creative types. */
export const TYPE_COLOR: Record<"video" | "image" | "slides", string> = {
  video: "#60A5FA", // sky
  image: "#FBBF24", // amber
  slides: "#A78BFA", // violet
};
export const TYPE_LABEL: Record<"video" | "image" | "slides", string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};
