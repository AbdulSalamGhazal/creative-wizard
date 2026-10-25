/**
 * Landing-page codes (2026-10).
 *
 * An ad that sends traffic somewhere OTHER than the product's own page is
 * named `<creative name> @<code>` on the platform — one space, an `@`, then
 * the code of a landing page registered on the Library's Landing pages tab.
 * The upload pipeline splits the cell here, matches the creative on the part
 * before the marker (trim-then-exact, unchanged) and the landing page on the
 * code (exact, case-sensitive), and stores the landing page on the record.
 * No marker means the main product page.
 *
 * A plain module (no "use client") on purpose: the pipeline, the creative
 * validators and the landing-page form all import it — see the RSC rule in
 * CLAUDE.md.
 */

/** The separator between a creative name and its landing code. */
export const LANDING_CODE_MARKER = " @";

/** Letters, digits, `-` and `_` — nothing that could hide a second marker. */
export const LANDING_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export const LANDING_CODE_MAX = 64;

export type LandingCodeSplit =
  | { ok: true; name: string; code: string | null }
  | { ok: false };

/**
 * Split an (already trimmed) creative-name cell into the creative name and its
 * landing code. The FIRST marker decides; everything after it must be one
 * valid code, so `X @ lp2`, `X @`, `X @a @b` and `X  @lp2` (two spaces) are
 * malformed rather than silently read some other way.
 */
export function splitLandingCode(cell: string): LandingCodeSplit {
  const at = cell.indexOf(LANDING_CODE_MARKER);
  if (at === -1) return { ok: true, name: cell, code: null };
  const name = cell.slice(0, at);
  const code = cell.slice(at + LANDING_CODE_MARKER.length);
  if (name === "" || name !== name.trimEnd() || !isValidLandingCode(code)) {
    return { ok: false };
  }
  return { ok: true, name, code };
}

export function isValidLandingCode(code: string): boolean {
  return code.length <= LANDING_CODE_MAX && LANDING_CODE_PATTERN.test(code);
}

/** The cell as the platform shows it — for messages that quote the row. */
export function withLandingCode(name: string, code: string | null): string {
  return code === null ? name : `${name}${LANDING_CODE_MARKER}${code}`;
}

/** A creative name the upload could never match, because it would be split. */
/**
 * How the NULL landing page reads in the UI: an ad with no ` @code` sends
 * its traffic to the product's own page (user wording, 2026-10-25). One
 * spelling, shared by the Trends → LPs table, its chart and its export.
 */
export const PRODUCT_PAGE_LABEL = "Product page";

/** A landing page's display name — the registered name, or the product page. */
export function landingPageLabel(name: string | null): string {
  return name ?? PRODUCT_PAGE_LABEL;
}

export function hasLandingMarker(name: string): boolean {
  return name.includes(LANDING_CODE_MARKER);
}
