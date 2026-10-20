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
 * FIRST + LAST word, every script (user decision, 2026-10-20): "Mary Jane
 * Watson" → "MW", «عبد السلام غزال» → «ع + ZWNJ + غ». The initial is a word's first
 * letter or digit, so punctuation never stands in ("Salam (seed admin)" →
 * "SA"), and two ARABIC initials are kept apart with a ZERO WIDTH NON-JOINER
 * (U+200C) — Arabic letters join, so they would otherwise render as one
 * connected glyph instead of two letters.
 */
export function initialsOf(name: string | null | undefined): string {
  const initials = (name ?? "").trim().split(/\s+/).map(initialOf).filter(Boolean);
  if (initials.length === 0) return "?";
  if (initials.length === 1) return initials[0]!;
  const first = initials[0]!;
  const last = initials[initials.length - 1]!;
  return ARABIC.test(first) && ARABIC.test(last) ? `${first}\u200C${last}` : `${first}${last}`;
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
