import type { IdentityColumnKey, MetricColumnKey } from "@/validators/summary";

/**
 * The Ads table's column LABELS — pure data, in a module with no
 * `"use client"`, so the table, the control and (if it ever needs them) the
 * server page all read one list. They must match the keys in
 * `validators/summary.ts`, which is what the URL and every saved view carry.
 */
/** Human labels for the Columns dropdown — must match the keys in validators/summary. */
export const IDENTITY_LABELS: Record<IdentityColumnKey, string> = {
  product: "Product",
  type: "Type",
  priority: "Priority",
  stage: "Stage",
  creator: "Creator",
  launch: "Launch date",
};
export const METRIC_LABELS: Record<MetricColumnKey, string> = {
  spend: "Spend",
  impressions: "Impressions",
  clicks: "Clicks",
  conversions: "Conversions",
  ctr: "CTR",
  cpm: "CPM",
  cpc: "CPC",
  cpa: "CPA",
  roas: "ROAS",
  hook_rate: "Hook rate",
  hold_rate: "Hold rate",
  complete_rate: "Complete rate",
  landing_page_views: "Landing page views",
  voc: "VOC",
  cvr: "CvR",
};


/**
 * The Ads table's column state is FOUR URL params of three different shapes
 * (`hideIdentity` / `hideMetrics` csv, `hideRate` / `hideBlended` booleans)
 * plus a group order. The columns system speaks ONE flat hidden list, so these
 * two functions are the only place that translates between them — the params
 * themselves are untouched, because every saved view is a stored query string.
 */
export const ADS_RATE_KEY = "rate";
export const ADS_TOTAL_KEY = "total";

export interface AdsHiddenColumns {
  identity: IdentityColumnKey[];
  metrics: MetricColumnKey[];
  rate: boolean;
  blended: boolean;
}

export function joinAdsHidden(parts: AdsHiddenColumns): string[] {
  return [
    ...parts.identity,
    ...parts.metrics,
    ...(parts.rate ? [ADS_RATE_KEY] : []),
    ...(parts.blended ? [ADS_TOTAL_KEY] : []),
  ];
}

export function splitAdsHidden(hidden: readonly string[]): AdsHiddenColumns {
  const set = new Set(hidden);
  return {
    identity: (Object.keys(IDENTITY_LABELS) as IdentityColumnKey[]).filter((k) =>
      set.has(k),
    ),
    metrics: (Object.keys(METRIC_LABELS) as MetricColumnKey[]).filter((k) => set.has(k)),
    rate: set.has(ADS_RATE_KEY),
    blended: set.has(ADS_TOTAL_KEY),
  };
}

/** Everything the Ads control can hide, in display order. */
export const ADS_HIDEABLE_KEYS: readonly string[] = [
  ...Object.keys(IDENTITY_LABELS),
  ...Object.keys(METRIC_LABELS),
  ADS_RATE_KEY,
  ADS_TOTAL_KEY,
];
