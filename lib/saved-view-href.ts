import { FILTERS_EXPLICIT_PARAM, VIEW_MARKER_PARAM } from "@/validators/user-prefs";

/**
 * Where a saved view lives and the URL that APPLIES it, for the ⌘K palette
 * (R-027). It MIRRORS `ViewsControl.applyView` (components/summary/
 * views-control.tsx), whose own copy stays where it is because
 * `components/filters/migrated-bars.test.ts` pins the marker lexically in that
 * file — change one, change both, or a view opened from the palette lands on a
 * different state than the same view picked from its page.
 */

/** A view's `page` key → its route. */
export const SAVED_VIEW_PATH: Record<string, string> = {
  summary: "/summary",
  creatives: "/library",
  campaigns: "/campaigns",
};

/** A view's `page` key → that page's sidebar label. */
export const SAVED_VIEW_PAGE_LABEL: Record<string, string> = {
  summary: "Ads",
  creatives: "Library",
  campaigns: "Campaigns",
};

/** Params that are never part of a view's stored state. */
export const TRANSIENT_VIEW_PARAMS: ReadonlySet<string> = new Set([
  "view",
  VIEW_MARKER_PARAM,
  FILTERS_EXPLICIT_PARAM,
]);

/** Strip transient params (e.g. the `view=none` escape) from a query string. */
export function cleanViewQuery(s: string): string {
  const p = new URLSearchParams(s);
  for (const k of TRANSIENT_VIEW_PARAMS) p.delete(k);
  return p.toString();
}

/**
 * The URL that applies view `viewId` (stored query `query`) on `pathname`.
 * The `sv` marker rides along so the server skips remembered filters — an
 * applied view owns the whole filter state, including what it leaves out. An
 * EMPTY view always routes through `?view=none`: a bare page would be
 * redirected straight back to the user's default view.
 */
export function savedViewHref(pathname: string, query: string, viewId: string): string {
  const clean = cleanViewQuery(query);
  return clean === ""
    ? `${pathname}?view=none&${VIEW_MARKER_PARAM}=${viewId}`
    : `${pathname}?${clean}&${VIEW_MARKER_PARAM}=${viewId}`;
}
