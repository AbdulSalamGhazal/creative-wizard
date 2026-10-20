/**
 * Bidirectional text helpers (2026-10-20) — Arabic and English side by side.
 *
 * A NAME interpolated into an English template ("«Name» mentioned you on
 * «anchor»") must not drag the sentence with it: an Arabic name at the start
 * of an English title would otherwise make the browser lay the whole line out
 * right-to-left. Wrapping each user-supplied part in FIRST STRONG ISOLATE …
 * POP DIRECTIONAL ISOLATE keeps it in its own direction and leaves the
 * template LTR — and because they are characters, not markup, it works
 * everywhere a title travels: the bell, a toast, /notifications, the tab
 * title.
 *
 * Written as escapes, never raw: invisible characters in source are a trap
 * (CLAUDE.md — the U+0001 dedup key).
 */
export const FSI = "\u2068";
export const PDI = "\u2069";

/** Isolate one user-supplied part of a template. Empty stays empty. */
export function isolate(text: string): string {
  return text === "" ? text : `${FSI}${text}${PDI}`;
}

/** Strip the isolates again (comparisons, search, tests). */
export function stripIsolates(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "");
}
