/**
 * THE BRAND IN THE URL (2026-11). Every dashboard page lives under
 * `/<brand-slug>/…` (`app/[brand]/(dashboard)`), so each TAB carries its own
 * brand: two tabs on two brands never interfere, Back/Forward and ⌘-click
 * keep the brand, and a shared link opens the brand it was copied from.
 *
 * Pure and dependency-free: the middleware (edge), the server (tenant,
 * redirects) and the client (links, router, fetch) all read this one file.
 *
 * A path's first segment is EXACTLY one of:
 *  - a BRANDED route (`library`, `budget`, …, `go`) → an unprefixed, legacy
 *    path: the middleware sends it to the last brand used in this browser;
 *  - a NON-BRAND root (`api`, `signin`, `oauth`, …) or a file → untouched;
 *  - anything else → a brand slug. Which is why a slug may never equal one of
 *    the first two lists (`isReservedSlug`, enforced when a brand is created).
 */

/**
 * Top-level dashboard routes — the directories under `app/[brand]/(dashboard)`
 * plus `go`. Pinned against the directory by `lib/brand-path.test.ts`, so a
 * new section can't be forgotten here.
 */
export const BRANDED_SEGMENTS: ReadonlySet<string> = new Set([
  "account",
  "activity",
  "admin",
  "budget",
  "campaigns",
  "canvas",
  "compare",
  "creatives",
  "funnel",
  "go",
  "library",
  "notifications",
  "price-structure",
  "store",
  "summary",
  "trends",
  "uploads",
]);

/** Roots that are never a brand: auth, APIs, OAuth discovery, assets. */
export const NON_BRAND_SEGMENTS: ReadonlySet<string> = new Set([
  "api",
  "signin",
  "oauth",
  ".well-known",
  "_next",
  "dev-uploads",
]);

/**
 * "Whichever brand you were last on" — the placeholder a legacy path is sent
 * to when this browser has no remembered brand yet. The dashboard layout
 * resolves it and redirects to the real slug.
 */
export const ANY_BRAND = "_";

/** The request header the middleware sets from the URL (and `brandFetch`
 *  sets for an API call). Set, never appended — a client's value on a page
 *  request is replaced. */
export const BRAND_HEADER = "x-ccms-brand";

/** The last brand this browser was on — a plain slug, written by the page
 *  (never secret: membership is checked on every request). */
export const LAST_BRAND_COOKIE = "ccms_brand";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** May `slug` be a brand's URL segment? */
export function isReservedSlug(slug: string): boolean {
  return slug === ANY_BRAND || BRANDED_SEGMENTS.has(slug) || NON_BRAND_SEGMENTS.has(slug);
}

/** A syntactically valid, unreserved slug (what a cookie or header may name). */
export function isBrandSlug(v: string | null | undefined): v is string {
  return typeof v === "string" && (v === ANY_BRAND || (SLUG_RE.test(v) && !isReservedSlug(v)));
}

function firstSegment(pathname: string): string {
  const i = pathname.indexOf("/", 1);
  return decodeURIComponentSafe(i === -1 ? pathname.slice(1) : pathname.slice(1, i));
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export type PathKind = "legacy" | "branded" | "other";

/** What the middleware does with a pathname (see the file comment). */
export function classifyPath(pathname: string): PathKind {
  if (pathname === "/" || pathname === "") return "legacy";
  const seg = firstSegment(pathname);
  if (BRANDED_SEGMENTS.has(seg)) return "legacy";
  if (NON_BRAND_SEGMENTS.has(seg) || seg.includes(".")) return "other";
  return "branded";
}

/** `/urjwan/library/x` → `{ slug: "urjwan", rest: "/library/x" }`; a path
 *  that isn't brand-prefixed → `{ slug: null, rest: pathname }`. */
export function splitBrandPath(pathname: string): { slug: string | null; rest: string } {
  if (classifyPath(pathname) !== "branded") return { slug: null, rest: pathname };
  const seg = firstSegment(pathname);
  const i = pathname.indexOf("/", 1);
  return { slug: seg, rest: i === -1 ? "/" : pathname.slice(i) };
}

/** The app path without its brand — what every page-matching rule reads. */
export function stripBrand(pathname: string): string {
  return splitBrandPath(pathname).rest;
}

/**
 * Put `href` under `slug`. Only an app-internal, unprefixed dashboard path is
 * touched: an already-branded path (another brand's link), an API/auth path,
 * a relative or external URL, or a hash/query-only href pass through.
 */
export function withBrand(slug: string | null | undefined, href: string): string {
  if (!slug || !href.startsWith("/") || href.startsWith("//")) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const tail = cut === -1 ? "" : href.slice(cut);
  if (classifyPath(path) !== "legacy") return href;
  return `/${slug}${path === "/" ? "" : path}${tail}`;
}

/**
 * Switching brand from a page that only exists in the OLD brand (a creative's
 * or campaign's own page): land on that section's list in the new brand, and
 * say so. Every other page keeps its path and query (as switching always
 * did), minus the params that name one brand's things: an open comment and a
 * Price Structure version.
 */
export interface SwitchTarget {
  href: string;
  /** Set when the page was another brand's item — the toast's words. */
  moved: { what: string; section: string } | null;
}

const DETAIL_ROUTES: { re: RegExp; list: string; what: string; section: string }[] = [
  { re: /^\/library\/(?!new$|bulk$)[^/]+$/, list: "/library", what: "creative", section: "Library" },
  { re: /^\/creatives\/[^/]+$/, list: "/library", what: "creative", section: "Library" },
  { re: /^\/campaigns\/(?!new$)[^/]+$/, list: "/campaigns", what: "campaign", section: "Campaigns" },
  {
    re: /^\/price-structure\/products\/.+$/,
    list: "/price-structure/products",
    what: "product",
    section: "Pricing",
  },
];

const BRAND_SCOPED_PARAMS = ["comment", "v"];

export function switchTarget(slug: string, appPath: string, search: string): SwitchTarget {
  const params = new URLSearchParams(search);
  for (const p of BRAND_SCOPED_PARAMS) params.delete(p);
  const detail = DETAIL_ROUTES.find((d) => d.re.test(appPath));
  if (detail) {
    return {
      href: withBrand(slug, detail.list),
      moved: { what: detail.what, section: detail.section },
    };
  }
  const qs = params.toString();
  return { href: withBrand(slug, `${appPath}${qs ? `?${qs}` : ""}`), moved: null };
}
