"use client";

import { useMemo, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { robustUpperBound } from "@/lib/chart-scale";
import { cn } from "@/lib/utils";

export interface ChartFit {
  /** A far-outlier spike exists above the fitted cap. */
  trimmed: boolean;
  /** User has expanded the axis to the full range. */
  expanded: boolean;
  /** Axis is currently capped (trimmed and not expanded). */
  clip: boolean;
  /** Fitted upper bound to use while capped. */
  cap: number;
  toggle: () => void;
}

/**
 * Compute a robust axis fit for a chart's Y values and track the user's
 * fit/full-range toggle. When no outlier is present, `clip`/`trimmed` are false
 * and the chart should keep its original axis (pass no override).
 */
export function useChartFit(values: number[], k = 3): ChartFit {
  const { cap, trimmed } = useMemo(
    () => robustUpperBound(values, k),
    [values, k],
  );
  const [expanded, setExpanded] = useState(false);
  const clip = trimmed && !expanded;
  return {
    trimmed,
    expanded,
    clip,
    cap,
    toggle: () => setExpanded((e) => !e),
  };
}

/**
 * Small overlay control, rendered only when a spike was trimmed, to switch
 * between the fitted axis and the full range. Place inside a `relative` chart
 * container.
 */
export function ChartFitToggle({
  fit,
  className,
}: {
  fit: ChartFit;
  className?: string;
}) {
  if (!fit.trimmed) return null;
  return (
    <button
      type="button"
      onClick={fit.toggle}
      title={
        fit.expanded
          ? "Fit the axis to the bulk (hide the outlier spike)"
          : "Show the full range (include the outlier spike)"
      }
      className={cn(
        "absolute top-0 right-0 z-10 inline-flex items-center gap-1 rounded-md border border-line bg-surface-2/85 backdrop-blur px-1.5 py-0.5 text-[10px] font-medium text-ink-2 hover:text-ink transition-colors",
        className,
      )}
    >
      {fit.expanded ? (
        <Minimize2 className="w-3 h-3" />
      ) : (
        <Maximize2 className="w-3 h-3" />
      )}
      {fit.expanded ? "Fit" : "Full range"}
    </button>
  );
}
