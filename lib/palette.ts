/**
 * Hex mirrors of the platform colors defined in app/globals.css.
 * Recharts and other DOM-renderers need literal color values, not CSS vars.
 * Keep these in sync with `--meta`, `--tiktok`, `--snapchat`, `--google`.
 */
export const PLATFORM_COLOR: Record<
  "meta" | "tiktok" | "snapchat" | "google",
  string
> = {
  meta: "#4f8efb",
  tiktok: "#ff4d7a",
  snapchat: "#ffd80b",
  google: "#34d399",
};

export const PLATFORM_LABEL: Record<
  "meta" | "tiktok" | "snapchat" | "google",
  string
> = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
};

export const ALL_PLATFORMS = ["meta", "tiktok", "snapchat", "google"] as const;

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
