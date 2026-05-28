/**
 * Accent palettes — a curated set of brand hues, independent of the
 * light/dark mode axis. Selecting one sets `data-accent` on <html>; the CSS in
 * globals.css maps that to `--brand` / `--brand-2` (and `--brand-soft` /
 * `--brand-glow` derive from those via color-mix). Everything that references
 * the brand token — primary buttons, focus rings, the logo gradient, active
 * nav indicators — re-colors automatically.
 *
 * `swatch` is the on-screen dot in the picker; it matches each accent's
 * `--brand`. Keep this list small and deliberate.
 */
export type AccentId = "magenta" | "violet" | "blue" | "emerald" | "amber";

export interface Accent {
  id: AccentId;
  label: string;
  swatch: string;
}

export const ACCENTS: Accent[] = [
  { id: "magenta", label: "Magenta", swatch: "#d4145a" },
  { id: "violet", label: "Violet", swatch: "#7c3aed" },
  { id: "blue", label: "Blue", swatch: "#2563eb" },
  { id: "emerald", label: "Emerald", swatch: "#059669" },
  { id: "amber", label: "Amber", swatch: "#d97706" },
];

export const ACCENT_IDS = ACCENTS.map((a) => a.id);

export const DEFAULT_ACCENT: AccentId = "magenta";

export const ACCENT_STORAGE_KEY = "accent";

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && (ACCENT_IDS as string[]).includes(value);
}
