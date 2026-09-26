import { z } from "zod";

/**
 * The param that says "a saved view owns this URL's filter state". Written by
 * the default-view redirect and by applying a view from the Views control;
 * read server-side to SKIP remembered filters entirely (user decision: the
 * view owns the state, and removing the default restores pref behaviour).
 *
 * It is deliberately NOT `view` — on the Library page that name is already the
 * grid/table display mode. Like `view`, it is transient: the Views control
 * strips it before saving or comparing a view's query.
 */
export const VIEW_MARKER_PARAM = "sv";

/**
 * The param that says "this URL states its filters in full". The shell's
 * writer stamps it on every filter change, and the change it writes also
 * MATERIALISES every remembered value into the URL — so from that moment the
 * URL is complete and preferences must not be re-applied on top of it.
 *
 * Without it, clearing a remembered filter would resurrect it: the write-through
 * is debounced and deliberately not awaited, so the very next render would
 * still read the old preference and put the filter back. With it, the URL wins
 * the moment the user touches a filter, and the preference is what the NEXT
 * bare visit starts from.
 */
export const FILTERS_EXPLICIT_PARAM = "fx";

/** True when the current URL is showing a saved view (see VIEW_MARKER_PARAM). */
export function isSavedViewApplied(raw: (key: string) => string | undefined): boolean {
  const v = raw(VIEW_MARKER_PARAM);
  return v !== undefined && v.length > 0;
}

/**
 * Filter keys that must NEVER be remembered — checked centrally so no page can
 * opt one in by accident. Search, sort, column visibility, the saved view and
 * the page's own view controls are not filters; the date range and the
 * Excluded toggle already have their own (older) mechanisms on `users`; and
 * `metricFilters` is the metric-rule builder — a CUSTOM def, excluded by
 * decision because a remembered rule set is more surprise than help.
 */
export const NEVER_PERSIST_FILTER_KEYS = [
  "q",
  "sort",
  "dir",
  "view",
  VIEW_MARKER_PARAM,
  FILTERS_EXPLICIT_PARAM,
  "page",
  "groupBy",
  "hide",
  "hideIdentity",
  "hideMetrics",
  "hideRate",
  "hideBlended",
  "from",
  "to",
  "includeExcluded",
  "metricFilters",
] as const;

export function isPersistableFilterKey(key: string): boolean {
  return !(NEVER_PERSIST_FILTER_KEYS as readonly string[]).includes(key);
}

/** One key's remembered value. An EMPTY `values` means "delete this row". */
export const filterPrefEntrySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(32)
    .refine(isPersistableFilterKey, { message: "That filter is never remembered." }),
  values: z.array(z.string().min(1).max(64)).max(50),
});

/** The write-through payload — small by construction (one burst of changes). */
export const filterPrefsSchema = z.object({
  entries: z.array(filterPrefEntrySchema).min(1).max(20),
});

export type FilterPrefEntry = z.infer<typeof filterPrefEntrySchema>;

/**
 * When preferences must NOT be resolved: the URL already states its filters in
 * full, or a saved view owns them. Checked centrally (see `resolveFilterPrefs`)
 * so no page can forget either rule.
 */
export function prefsSuppressed(raw: (key: string) => string | undefined): boolean {
  return isSavedViewApplied(raw) || (raw(FILTERS_EXPLICIT_PARAM) ?? "").length > 0;
}
