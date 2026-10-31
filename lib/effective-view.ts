import { FILTERS_EXPLICIT_PARAM, VIEW_MARKER_PARAM } from "@/validators/user-prefs";

/**
 * A page's EFFECTIVE view as a query string — what the user actually sees, not
 * what the address bar says (2026-11-01).
 *
 * Range, remembered filters and the Excluded toggle resolve SERVER-side
 * (URL → saved preference → page default), so on a remembered-filter page the
 * address bar can be bare while the page shows Facebook · TikTok, the last 14
 * days, excluded hidden. A comment stored that bare string as its view, and its
 * deep link then showed the READER's preferences (comments-notifications.md,
 * invariant (a)). This states the view in full:
 *
 *  · the URL's own params, verbatim and first;
 *  · each resolved filter the URL doesn't carry, plus `fx=1` — the house
 *    "this URL states its filters in full" marker, so the reader's own
 *    preferences are not overlaid. Skipped when the URL already has `fx`
 *    (it IS the full statement) or `sv` (a saved view owns its filter state,
 *    including what it leaves out — it keeps its `sv` instead);
 *  · the range as ABSOLUTE dates, when the URL doesn't state both ends;
 *  · the Excluded state, when the URL doesn't state it.
 *
 * Pure and free of UI: the comment panel uses it today, and a "Copy link" could
 * reuse it.
 */
export interface ResolvedView {
  /**
   * The bar's filters as the server resolved them for this render. Present —
   * even empty — when the page resolves remembered filters at all.
   */
  filters?: Record<string, string | undefined>;
  /** The range the page ran (the picker's effective range). */
  range?: { from: string; to: string };
  /** The Excluded state the page ran. */
  includeExcluded?: boolean;
}

export function effectiveView(search: string, resolved: ResolvedView): string {
  const base = search.startsWith("?") ? search.slice(1) : search;
  const url = new URLSearchParams(base);
  const added = new URLSearchParams();
  const add = (key: string, value: string) => {
    if (!url.has(key) && !added.has(key)) added.set(key, value);
  };

  if (resolved.filters && !url.has(VIEW_MARKER_PARAM)) {
    if (!url.has(FILTERS_EXPLICIT_PARAM)) {
      for (const [key, value] of Object.entries(resolved.filters)) {
        if (value) add(key, value);
      }
    }
    add(FILTERS_EXPLICIT_PARAM, "1");
  }
  // The URL's own params stay verbatim unless a half range has to go.
  let rewritten = false;
  if (resolved.range && !(url.has("from") && url.has("to"))) {
    // A half range is no range (resolvePreferredRange ignores it): state both.
    if (url.has("from") || url.has("to")) {
      url.delete("from");
      url.delete("to");
      rewritten = true;
    }
    add("from", resolved.range.from);
    add("to", resolved.range.to);
  }
  if (resolved.includeExcluded !== undefined) {
    add("includeExcluded", resolved.includeExcluded ? "1" : "0");
  }

  const head = rewritten ? url.toString() : base;
  const tail = added.toString();
  return [head, tail].filter(Boolean).join("&");
}
