/**
 * The Dashboard's plotted metric (R-070): the KPI tiles ARE the "Performance
 * over time" chart's metric selector. Both read and write the chart's own
 * view param — `useChartView`'s `${prefix}m` (R-102), so `?otm=` is the ONE
 * source of truth; there is no second param. A plain module so the tiles and
 * the chart agree on the vocabulary; `spend` is the default and is never
 * written to the URL.
 */
export const DASHBOARD_CHART_PREFIX = "ot";

/** The URL param the metric lives in (`useChartView`'s `${prefix}m`). */
export const DASHBOARD_METRIC_PARAM = `${DASHBOARD_CHART_PREFIX}m`;

export const DASHBOARD_METRICS = [
  "spend",
  "revenue",
  "conversions",
  "cpa",
  "roas",
] as const;

export type DashboardMetricKey = (typeof DASHBOARD_METRICS)[number];

export const DEFAULT_DASHBOARD_METRIC: DashboardMetricKey = "spend";

/** A URL value → a known metric, anything else → the default. */
export function parseDashboardMetric(
  value: string | null | undefined,
): DashboardMetricKey {
  return (DASHBOARD_METRICS as readonly string[]).includes(value ?? "")
    ? (value as DashboardMetricKey)
    : DEFAULT_DASHBOARD_METRIC;
}
