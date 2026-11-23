import { METRIC_LABEL } from "@/lib/metric-labels";

/**
 * The campaigns table's column META — keys, labels, alignment, which one is
 * pinned. PURE DATA, and this module has NO `"use client"` for exactly that
 * reason: the server page needs these values to resolve remembered columns,
 * and **every export of a client module is a client-reference proxy on the
 * server**, so reading one there throws at request time while typecheck and
 * `next build` stay perfectly green. That is how /campaigns shipped broken
 * (e613d37) — the page imported this list from the `"use client"` table.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a server component may import a client
 * COMPONENT, never a VALUE from a client module. Shared data lives in a plain
 * module both sides import.
 *
 * The table derives its render config from this list, so the two can't drift.
 */
export type ColumnAlign = "left" | "right";

export interface CampaignColumnMeta {
  key: string;
  label: string;
  align: ColumnAlign;
  sortable: boolean;
  /** The identity column: pinned, never hidden or reordered. */
  pinned?: boolean;
  defaultSortDir?: "asc" | "desc";
  /**
   * Offered, hidden by default (2026-11). This table is URL-backed, so its
   * `hide` param carries the opt-in as `!key` (`SHOW_MARKER`): a URL or saved
   * view that never mentions the column keeps it hidden, and every existing
   * `hide` value means exactly what it meant.
   */
  defaultHidden?: boolean;
}

export const CAMPAIGN_COLS_META: readonly CampaignColumnMeta[] = [
  // The identity column of the AD SETS list — the row this table calls a
  // "campaign" is the UI's ad set (lib/campaign.ts, "TWO LEVELS"). The KEY is
  // stored in saved views and preferences, so it keeps its name.
  { key: "campaign", label: "Ad set", align: "left", sortable: true, pinned: true, defaultSortDir: "asc" },
  { key: "objective", label: "Objective", align: "left", sortable: true, defaultSortDir: "asc" },
  { key: "status", label: "Status", align: "left", sortable: true, defaultSortDir: "asc" },
  { key: "platforms", label: "Platform", align: "left", sortable: false },
  { key: "creatives", label: "Creatives", align: "right", sortable: true },
  { key: "spend", label: "Spend", align: "right", sortable: true },
  { key: "impressions", label: METRIC_LABEL.impressions, align: "right", sortable: true },
  { key: "clicks", label: "Clicks", align: "right", sortable: true },
  { key: "orders", label: METRIC_LABEL.conversions, align: "right", sortable: true },
  { key: "revenue", label: METRIC_LABEL.revenue, align: "right", sortable: true },
  { key: "cpa", label: "CPA", align: "right", sortable: true },
  { key: "roas", label: "ROAS", align: "right", sortable: true },
  { key: "aov", label: "AOV", align: "right", sortable: true },
  { key: "ctr", label: "CTR", align: "right", sortable: true },
  { key: "cpm", label: "CPM", align: "right", sortable: true },
  { key: "cvr", label: "CvR", align: "right", sortable: true },
  { key: "lastDate", label: "Last", align: "right", sortable: true },
  // ── Offered, hidden by default (2026-11): fields the query already carries
  //    at the campaign grain (an existing SELECT or the campaigns PK join) ──
  { key: "lpv", label: METRIC_LABEL.landingPageViews, align: "right", sortable: true, defaultHidden: true },
  { key: "addToCart", label: METRIC_LABEL.addToCart, align: "right", sortable: true, defaultHidden: true },
  { key: "addPayment", label: METRIC_LABEL.addPayment, align: "right", sortable: true, defaultHidden: true },
  { key: "voc", label: METRIC_LABEL.voc, align: "right", sortable: true, defaultHidden: true },
  { key: "cpc", label: METRIC_LABEL.cpc, align: "right", sortable: true, defaultHidden: true },
  { key: "firstDate", label: "First", align: "right", sortable: true, defaultHidden: true },
  { key: "createdAt", label: "Created", align: "right", sortable: true, defaultHidden: true },
];

/** Hideable columns (everything but the identity column) — the columns control. */
export const CAMPAIGN_TABLE_COLUMNS: ReadonlyArray<{ key: string; label: string }> =
  CAMPAIGN_COLS_META.filter((c) => !c.pinned).map((c) => ({ key: c.key, label: c.label }));

/** Their keys in config order — what a saved order is merged against. */
export const CAMPAIGN_COLUMN_KEYS: readonly string[] = CAMPAIGN_TABLE_COLUMNS.map(
  (c) => c.key,
);

/** The columns a first visit (and every existing URL / saved view) hides. */
export const CAMPAIGN_DEFAULT_HIDDEN: readonly string[] = CAMPAIGN_COLS_META.filter(
  (c) => c.defaultHidden,
).map((c) => c.key);

/**
 * THE TWO LEVELS OF THE ONE TABLE (2026-11). `adset` is the list above (its
 * stored table key is still `campaigns`); `campaign` is one row per CAMPAIGN —
 * the same columns with its own identity label and an "Ad sets" count, DERIVED
 * from the ad-set list so the two can't drift.
 */
export type PortfolioLevel = "adset" | "campaign";

export const PARENT_CAMPAIGN_COLS_META: readonly CampaignColumnMeta[] = CAMPAIGN_COLS_META.flatMap(
  (c): CampaignColumnMeta[] => {
    if (c.key === "campaign") return [{ ...c, label: "Campaign" }];
    // The ad sets it holds, right after where it runs.
    if (c.key === "platforms") {
      return [c, { key: "adSets", label: "Ad sets", align: "right", sortable: true }];
    }
    return [c];
  },
);

/** Columns that are NOT a number — everything else reads "—" on a never-run campaign. */
const NON_NUMERIC = new Set(["campaign", "objective", "status", "platforms", "adSets", "createdAt"]);

export interface PortfolioLevelMeta {
  cols: readonly CampaignColumnMeta[];
  /** Hideable columns (all but the identity column), for the columns control. */
  tableColumns: ReadonlyArray<{ key: string; label: string }>;
  columnKeys: readonly string[];
  defaultHidden: readonly string[];
  numericKeys: ReadonlySet<string>;
  csvFileName: string;
  emptyTitle: string;
}

function levelMeta(
  cols: readonly CampaignColumnMeta[],
  csvFileName: string,
  emptyTitle: string,
): PortfolioLevelMeta {
  const tableColumns = cols.filter((c) => !c.pinned).map((c) => ({ key: c.key, label: c.label }));
  return {
    cols,
    tableColumns,
    columnKeys: tableColumns.map((c) => c.key),
    defaultHidden: cols.filter((c) => c.defaultHidden).map((c) => c.key),
    numericKeys: new Set(cols.map((c) => c.key).filter((k) => !NON_NUMERIC.has(k))),
    csvFileName,
    emptyTitle,
  };
}

export const PORTFOLIO_LEVELS: Record<PortfolioLevel, PortfolioLevelMeta> = {
  adset: levelMeta(CAMPAIGN_COLS_META, "ad-sets", "No ad sets match these filters."),
  campaign: levelMeta(PARENT_CAMPAIGN_COLS_META, "campaigns", "No campaigns match these filters."),
};
