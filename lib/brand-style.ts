import { brandColorEnum, type BrandColorKey } from "@/lib/enums";

/**
 * A brand's look at a glance (2026-11): a colour swatch and an optional logo,
 * set on Configuration → Brands. Client-safe — the switcher, the top-bar
 * accent and the Brands editor all read it.
 *
 * Every swatch is a chart-series token (app/globals.css), so it re-tunes per
 * theme the way platform colours do: 400-level on the dark themes, 600-level
 * on the light ones. The set skips the pacing verdict hues (ahead blue,
 * behind amber) and red, so a brand never reads as a verdict.
 */
export const BRAND_COLORS: Record<BrandColorKey, { label: string; token: string }> = {
  pink: { label: "Pink", token: "var(--series-2)" },
  violet: { label: "Violet", token: "var(--series-5)" },
  green: { label: "Green", token: "var(--series-3)" },
  teal: { label: "Teal", token: "var(--series-12)" },
  cyan: { label: "Cyan", token: "var(--series-7)" },
  indigo: { label: "Indigo", token: "var(--series-9)" },
  fuchsia: { label: "Fuchsia", token: "var(--series-11)" },
  orange: { label: "Orange", token: "var(--series-6)" },
  lime: { label: "Lime", token: "var(--series-15)" },
  purple: { label: "Purple", token: "var(--series-16)" },
};

export function isBrandColorKey(v: unknown): v is BrandColorKey {
  return typeof v === "string" && (brandColorEnum as readonly string[]).includes(v);
}

/** FNV-1a — a stable, well-spread hash of the brand id. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The brand's swatch: the one chosen, else a STABLE default derived from its
 * id — so a brand nobody styled still has a colour, the same one on every
 * surface and every visit (and renaming it doesn't repaint it).
 */
export function brandColorKey(brand: { id: string; color?: string | null }): BrandColorKey {
  if (isBrandColorKey(brand.color)) return brand.color;
  return brandColorEnum[hash(brand.id) % brandColorEnum.length]!;
}

/** The CSS colour for a brand — a `var(--series-N)` reference. */
export function brandColor(brand: { id: string; color?: string | null }): string {
  return BRAND_COLORS[brandColorKey(brand)].token;
}

/** One letter for the logo-less mark — the first letter or digit of the name. */
export function brandInitial(name: string | null | undefined): string {
  const m = (name ?? "").trim().match(/[\p{L}\p{N}]/u);
  return m ? m[0].toLocaleUpperCase() : "?";
}

/** The brand fields every brand-styled surface needs. */
export interface BrandStyle {
  id: string;
  /** The brand's URL segment (`/<slug>/…`). */
  slug: string;
  name: string;
  color: string | null;
  logoUrl: string | null;
}
