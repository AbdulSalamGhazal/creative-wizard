import { seriesColor } from "@/lib/palette";

/**
 * Deterministic person avatars — initials plus a colour derived from the name,
 * so the same person always looks the same wherever they appear and nothing
 * has to be stored. The colours are the shared series vars, which already have
 * light-theme overrides, rather than a second palette nobody would maintain.
 */

/** The first LETTER (or digit) of a word — "(seed" gives "s", not "(". */
function initialOf(word: string): string {
  return word.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "";
}

const ARABIC = /\p{Script=Arabic}/u;

/**
 * "Abdulsalam Ghazal" → "AG"; one word → one letter; nothing → "?".
 *
 * Any script (2026-10): the initial is a word's first letter or digit, so
 * punctuation never stands in ("Salam (seed admin)" → "SS"), and two ARABIC
 * initials are kept apart with a ZERO WIDTH NON-JOINER (U+200C) — Arabic
 * letters join, so "عبد السلام" would otherwise render its two initials as one
 * connected glyph instead of two letters.
 */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = parts.map(initialOf).filter(Boolean).slice(0, 2);
  if (initials.length === 2 && ARABIC.test(initials[0]!) && ARABIC.test(initials[1]!)) {
    return `${initials[0]}\u200C${initials[1]}`;
  }
  return initials.join("") || "?";
}

/** A stable small hash — same name, same bucket, on every render and device. */
function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The avatar's background: one of the shared series colours, by name. */
export function avatarColor(name: string | null | undefined): string {
  return seriesColor(hash((name ?? "").trim().toLowerCase()));
}
