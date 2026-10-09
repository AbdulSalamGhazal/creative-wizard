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
}

export const CAMPAIGN_COLS_META: readonly CampaignColumnMeta[] = [
  { key: "campaign", label: "Campaign", align: "left", sortable: true, pinned: true, defaultSortDir: "asc" },
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
];

/** Hideable columns (everything but the identity column) — the columns control. */
export const CAMPAIGN_TABLE_COLUMNS: ReadonlyArray<{ key: string; label: string }> =
  CAMPAIGN_COLS_META.filter((c) => !c.pinned).map((c) => ({ key: c.key, label: c.label }));

/** Their keys in config order — what a saved order is merged against. */
export const CAMPAIGN_COLUMN_KEYS: readonly string[] = CAMPAIGN_TABLE_COLUMNS.map(
  (c) => c.key,
);
