import {
  IDENTITY_OPT_IN_KEYS,
  METRIC_OPT_IN_KEYS,
  type AdsOptInKey,
  type IdentityColumnKey,
  type IdentityOptInKey,
  type MetricColumnKey,
  type MetricOptInKey,
} from "@/validators/summary";
import { METRIC_LABEL } from "@/lib/metric-labels";

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
 * The OFFERED columns (2026-11): hidden until a URL / view / preference opts
 * one in with `!key` — see `IDENTITY_OPT_IN_KEYS` in validators/summary.
 */
export const IDENTITY_OPT_IN_LABELS: Record<IdentityOptInKey, string> = {
  angles: "Angles",
  email: "Creator email",
  thumbnail: "Thumbnail",
  notes: "Notes",
  created: "Created at",
};
export const METRIC_OPT_IN_LABELS: Record<MetricOptInKey, string> = {
  revenue: METRIC_LABEL.revenue,
  aov: "AOV",
};
/** Every default-hidden key — the columns hook's `defaultHidden`. */
export const ADS_DEFAULT_HIDDEN: readonly AdsOptInKey[] = [
  ...IDENTITY_OPT_IN_KEYS,
  ...METRIC_OPT_IN_KEYS,
];
const OPT_IN = "!";


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
  /** The default-hidden columns this state OPENS (absent = none opened). */
  shown?: AdsOptInKey[];
}

/**
 * The column state as the URL and the precedence resolver STATE it: hidden
 * keys as themselves, an opened default-hidden column as `!key`. Decode it
 * with `resolveColumnPrefs({ defaultHidden: ADS_DEFAULT_HIDDEN })`.
 */
export function joinAdsHidden(parts: AdsHiddenColumns): string[] {
  return [
    ...parts.identity,
    ...parts.metrics,
    ...(parts.rate ? [ADS_RATE_KEY] : []),
    ...(parts.blended ? [ADS_TOTAL_KEY] : []),
    ...(parts.shown ?? []).map((k) => `${OPT_IN}${k}`),
  ];
}

/** The DECODED hidden list — what the columns hook holds: every closed
 *  default-hidden column is in it, by name. */
export function adsHiddenKeys(parts: AdsHiddenColumns): string[] {
  const shown = new Set<string>(parts.shown ?? []);
  return [
    ...parts.identity,
    ...parts.metrics,
    ...(parts.rate ? [ADS_RATE_KEY] : []),
    ...(parts.blended ? [ADS_TOTAL_KEY] : []),
    ...ADS_DEFAULT_HIDDEN.filter((k) => !shown.has(k)),
  ];
}

/** A DECODED hidden list (the hook's / the resolver's) back into parts. */
export function splitAdsHidden(hidden: readonly string[]): AdsHiddenColumns {
  const set = new Set(hidden);
  return {
    identity: (Object.keys(IDENTITY_LABELS) as IdentityColumnKey[]).filter((k) =>
      set.has(k),
    ),
    metrics: (Object.keys(METRIC_LABELS) as MetricColumnKey[]).filter((k) => set.has(k)),
    rate: set.has(ADS_RATE_KEY),
    blended: set.has(ADS_TOTAL_KEY),
    shown: ADS_DEFAULT_HIDDEN.filter((k) => !set.has(k)),
  };
}

/** Everything the Ads control can hide, in display order. */
export const ADS_HIDEABLE_KEYS: readonly string[] = [
  ...Object.keys(IDENTITY_LABELS),
  ...IDENTITY_OPT_IN_KEYS,
  ...Object.keys(METRIC_LABELS),
  ...METRIC_OPT_IN_KEYS,
  ADS_RATE_KEY,
  ADS_TOTAL_KEY,
];

/**
 * The two csv params as lists (each may carry `!key` opt-ins) → parts. Shared
 * by the server page (validated lists) and `adsColumnsFromParams` (raw URL).
 */
export function adsColumnsFromLists(
  identity: readonly string[],
  metrics: readonly string[],
  rate: boolean,
  blended: boolean,
): AdsHiddenColumns {
  const id = new Set(identity);
  const me = new Set(metrics);
  return {
    identity: (Object.keys(IDENTITY_LABELS) as IdentityColumnKey[]).filter((k) => id.has(k)),
    metrics: (Object.keys(METRIC_LABELS) as MetricColumnKey[]).filter((k) => me.has(k)),
    rate,
    blended,
    shown: [
      ...IDENTITY_OPT_IN_KEYS.filter((k) => id.has(`${OPT_IN}${k}`)),
      ...METRIC_OPT_IN_KEYS.filter((k) => me.has(`${OPT_IN}${k}`)),
    ],
  };
}

/** The four column params' names — the URL shape every saved view carries. */
export const ADS_COLUMN_PARAMS = ["hideIdentity", "hideMetrics", "hideRate", "hideBlended"] as const;

/**
 * The column choice a URL STATES, or null when it states none (a bare URL
 * falls through to the saved view / preference / config — resolved on the
 * server). The client reads this live (D12): a toggle rewrites the URL
 * shallowly, with no server render, so the table can't wait for new props.
 * Parses exactly like `validators/summary.ts` (unknown keys dropped).
 */
export function adsColumnsFromParams(params: {
  get(key: string): string | null;
  has(key: string): boolean;
}): AdsHiddenColumns | null {
  if (!ADS_COLUMN_PARAMS.some((k) => params.has(k))) return null;
  const csv = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
  const flag = (key: string) => {
    const v = params.get(key);
    return v === "1" || v === "true";
  };
  return adsColumnsFromLists(
    csv("hideIdentity"),
    csv("hideMetrics"),
    flag("hideRate"),
    flag("hideBlended"),
  );
}

/** Write a column choice into params, in the four-param URL shape. */
export function writeAdsColumnParams(params: URLSearchParams, parts: AdsHiddenColumns): void {
  const setCsv = (key: string, values: readonly string[]) => {
    if (values.length === 0) params.delete(key);
    else params.set(key, values.join(","));
  };
  const shown = new Set<string>(parts.shown ?? []);
  const opened = (keys: readonly string[]) =>
    keys.filter((k) => shown.has(k)).map((k) => `${OPT_IN}${k}`);
  setCsv("hideIdentity", [...parts.identity, ...opened(IDENTITY_OPT_IN_KEYS)]);
  setCsv("hideMetrics", [...parts.metrics, ...opened(METRIC_OPT_IN_KEYS)]);
  if (parts.rate) params.set("hideRate", "1");
  else params.delete("hideRate");
  if (parts.blended) params.set("hideBlended", "1");
  else params.delete("hideBlended");
}
