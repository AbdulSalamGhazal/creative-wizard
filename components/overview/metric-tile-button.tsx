"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useChartView } from "@/components/charts/use-chart-view";
import {
  DASHBOARD_CHART_PREFIX,
  DASHBOARD_METRICS,
  DEFAULT_DASHBOARD_METRIC,
  type DashboardMetricKey,
} from "@/lib/dashboard-metric";
import { cn } from "@/lib/utils";

/**
 * The Dashboard's plotted metric — the "Performance over time" chart's own
 * view param (`useChartView`, prefix "ot" → `?otm=`), so the tiles and the
 * chart share ONE source of truth (shallow, D12: no server render). The
 * default is never written, so a clean URL means Spend.
 */
export function useDashboardMetric(): [
  DashboardMetricKey,
  (next: DashboardMetricKey) => void,
] {
  const { metric, setMetric } = useChartView<DashboardMetricKey>(
    DASHBOARD_CHART_PREFIX,
    DASHBOARD_METRICS,
    DEFAULT_DASHBOARD_METRIC,
  );
  return [metric, setMetric];
}

/**
 * A KPI tile that is also the chart's metric selector (R-070): pressing it
 * plots that metric in "Performance over time" below; the selected tile wears
 * the brand border. The tile itself (a server-rendered MetricCard) is the
 * child, so the tile looks exactly like every other KPI tile.
 */
export function MetricTileButton({
  metric,
  label,
  children,
}: {
  metric: DashboardMetricKey;
  label: string;
  children: ReactNode;
}) {
  const [current, setMetric] = useDashboardMetric();
  const pressed = current === metric;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setMetric(metric);
    }
  };
  return (
    // A div with the button role: the tile holds block content (a list of
    // breakdown bars), which a <button> may not contain.
    <div
      role="button"
      tabIndex={0}
      aria-pressed={pressed}
      title={`Plot ${label} over time`}
      onClick={() => setMetric(metric)}
      onKeyDown={onKeyDown}
      className={cn(
        "min-w-0 cursor-pointer rounded-lg text-left [&>div]:h-full [&>div]:transition-colors",
        pressed
          ? "[&>div]:border-brand"
          : "hover:[&>div]:border-line-2",
      )}
    >
      {children}
    </div>
  );
}
