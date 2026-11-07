import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one hover cursor for every line, composed and scatter chart — a dashed
 * rule in the muted ink, the gridlines' dash, so it reads on every theme.
 * Recharts' default is a fixed `#ccc` (glaring on Midnight, faint on Frost).
 * Bar charts keep their band cursor (`{ fill: "var(--surface-2)" }`).
 */
export const CHART_CURSOR = { stroke: "var(--ink-3)", strokeDasharray: "3 3" };

/**
 * The one line-weight ladder (R-101, 2026-11): a chart's data series is
 * `primary`; a reference line (plan, projection, the previous period's ghost)
 * is `secondary`; a single combined "Group" line is `emphasis`. Every <Line>
 * reads it, so a series weighs the same on every page.
 */
export const CHART_STROKE = { primary: 2, secondary: 1.5, emphasis: 2.25 } as const;

/**
 * The one Recharts custom-tooltip surface — the frosted popover card that every
 * chart's tooltip renders into. Was copy-pasted (with drift in class order and
 * width caps) across 10 chart files; they now all render through this. Pass a
 * `className` for an optional width cap (e.g. `max-w-xs`).
 */
export function ChartTooltip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg",
        className,
      )}
    >
      {children}
    </div>
  );
}
