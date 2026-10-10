/**
 * The unified table-columns system — the PURE half (phase 1, 2026-10).
 *
 * One control lives on `DataTable` itself and every table that passes a
 * `columnsKey` gets it, with the choice remembered PER USER PER BRAND. This
 * module owns the vocabulary and the three rules that make that safe:
 *
 *  1. **HIDDEN-KEY semantics.** A column absent from `hidden` is VISIBLE, so a
 *     column added later shows up for everyone instead of hiding behind a
 *     stored "visible" list that predates it. (The same rule
 *     `usePersistentHidden` used per browser, now per user per brand.)
 *  2. **A saved ORDER merges, never replaces.** Keys that no longer exist are
 *     dropped and new ones land at their DEFAULT positions — a saved order
 *     from last month must not bury this month's new column at the end.
 *  3. **The registry is the allow list.** A table key that isn't declared here
 *     is refused by the write action, so a hand-made request can't fill the
 *     table with junk rows.
 */

/**
 * Every table that persists its columns. Phase 1 wires three; the phase-2
 * sweep adds the rest. **Add a table here before passing its `columnsKey`** —
 * the key is stored, so these strings are effectively schema.
 */
export const TABLE_KEYS = {
  /** Campaign detail → the records/by-day table. */
  CAMPAIGN_RECORDS: "campaign-records",
  /** /campaigns → the portfolio table (URL-backed, saved views own columns). */
  CAMPAIGNS: "campaigns",
  /** /store/orders → the orders table. */
  STORE_ORDERS: "store-orders",

  // ── Phase 2 (2026-10): the rest of the tables ──────────────────────────
  /** Library (`/library`) — the creatives table. */
  LIBRARY: "library",
  /** Ads (`/summary`) — the grouped platform-group table. */
  ADS_SUMMARY: "ads-summary",
  /** Campaign detail → the creatives that ran in it. */
  CAMPAIGN_CREATIVES: "campaign-creatives",
  /** Creative detail → its campaigns/platforms table (both modes). */
  CREATIVE_CAMPAIGNS: "creative-campaigns",
  /** Trends → By angle. */
  TRENDS_ANGLES: "trends-angles",
  /** Trends → Video diagnostics. */
  TRENDS_VIDEO: "trends-video",
  /** Store → Insights, the breakdown table. */
  STORE_INSIGHTS: "store-insights",
  /** Store → Reconciliation, Channels view. */
  RECON_CHANNELS: "recon-channels",
  /** Store → Reconciliation, Platforms view (its own column universe). */
  RECON_PLATFORMS: "recon-platforms",
  /** Budget → Pacing, the per-bucket table. */
  BUDGET_PACING: "budget-pacing",
  /** Budget → Overview, the allocation check. */
  BUDGET_ALLOCATION: "budget-allocation",
  /** Budget → Tracker, the TABLE view (the bars view is exempt). */
  BUDGET_TRACKER: "budget-tracker",
  /** Budget → Audience, the pair board. */
  BUDGET_AUDIENCE: "budget-audience",
} as const;

export type TableKey = (typeof TABLE_KEYS)[keyof typeof TABLE_KEYS];

/** Derived — never hand-list the keys. */
export const TABLE_KEY_LIST: readonly TableKey[] = Object.values(TABLE_KEYS);

export function isTableKey(value: string): value is TableKey {
  return (TABLE_KEY_LIST as readonly string[]).includes(value);
}

/** What one table remembers. Empty arrays mean "the default". */
export interface TableColumnPref {
  hidden: string[];
  order: string[];
}

export const EMPTY_TABLE_PREF: TableColumnPref = { hidden: [], order: [] };

/**
 * A saved order, reconciled against the columns that exist TODAY.
 *
 * Saved keys that no longer exist are dropped; keys the save never knew about
 * are inserted where the CONFIG puts them — immediately after their nearest
 * preceding neighbour that survived, or at the front when nothing precedes
 * them. Appending them instead would quietly bury every new column at the end
 * of the table for everyone who had ever reordered it.
 */
export function mergeColumnOrder(
  saved: readonly string[],
  defaults: readonly string[],
): string[] {
  const known = new Set(defaults);
  const out: string[] = [];
  const present = new Set<string>();
  for (const key of saved) {
    if (!known.has(key) || present.has(key)) continue;
    out.push(key);
    present.add(key);
  }
  for (let i = 0; i < defaults.length; i++) {
    const key = defaults[i]!;
    if (present.has(key)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.indexOf(defaults[j]!);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    out.splice(at, 0, key);
    present.add(key);
  }
  return out;
}

/**
 * A saved hidden set against today's columns: unknown keys dropped (a column
 * that was removed must not keep a dead entry alive), duplicates collapsed.
 * Everything not listed is visible — that is the whole semantic.
 */
export function mergeHiddenColumns(
  saved: readonly string[],
  hideable: readonly string[],
): string[] {
  const allowed = new Set(hideable);
  return [...new Set(saved.filter((k) => allowed.has(k)))];
}

/** Encode/decode for the URL-backed tables (`?hide=`, `?order=`). */
export function parseColumnList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface ColumnPrecedenceInput {
  /** What the URL says (`?hide=` / `?order=`), already split. */
  url?: { hidden?: string[]; order?: string[] };
  /** True while a saved view owns the URL — preferences are suppressed. */
  viewApplied?: boolean;
  /** This user's remembered choice for this table in this brand. */
  pref?: TableColumnPref | null;
  /** The table's own column config, in config order. */
  hideable: readonly string[];
  defaults: readonly string[];
}

/**
 * **URL → applied view → preference → default**, in one place.
 *
 * The URL is the state of THIS navigation, so it always wins; a saved view
 * owns the URL it produced, including the columns it leaves out, so while one
 * is applied the preference is not consulted at all (the same `sv` marker the
 * remembered filters use — there is no second suppression mechanism). Only a
 * bare URL falls through to the preference, and then to the config.
 */
export function resolveColumnPrefs(input: ColumnPrecedenceInput): TableColumnPref {
  const urlHidden = input.url?.hidden ?? [];
  const urlOrder = input.url?.order ?? [];
  const usePref = !input.viewApplied && input.pref != null;

  const hidden =
    urlHidden.length > 0
      ? mergeHiddenColumns(urlHidden, input.hideable)
      : usePref
        ? mergeHiddenColumns(input.pref!.hidden, input.hideable)
        : [];

  const order =
    urlOrder.length > 0
      ? mergeColumnOrder(urlOrder, input.defaults)
      : usePref && input.pref!.order.length > 0
        ? mergeColumnOrder(input.pref!.order, input.defaults)
        : [];

  return { hidden, order };
}

/**
 * Is this state the table's DEFAULT — nothing to remember?
 *
 * Phase 2 made this non-trivial: some tables ship with columns hidden on a
 * first visit (the Library's notes/thumbnail/…, Trends' long metric tail), so
 * "nothing hidden" is a real opinion there, not the absence of one. The CLIENT
 * decides, because only it knows the config; the row is then deleted (reset)
 * or upserted accordingly.
 */
export function isDefaultColumnState(
  state: TableColumnPref,
  defaultHidden: readonly string[] = [],
): boolean {
  if (state.order.length > 0) return false;
  if (state.hidden.length !== defaultHidden.length) return false;
  const want = new Set(defaultHidden);
  return state.hidden.every((k) => want.has(k));
}

/**
 * Move one key by `delta` within an order, clamped at the ends. The arrow
 * buttons and Alt+Up/Down both go through this: dragging is not an input
 * method everyone has, and a keyboard user must be able to reorder too.
 */
export function moveColumn(
  order: readonly string[],
  key: string,
  delta: number,
): string[] {
  const from = order.indexOf(key);
  if (from < 0) return [...order];
  const to = Math.min(order.length - 1, Math.max(0, from + delta));
  if (to === from) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}
