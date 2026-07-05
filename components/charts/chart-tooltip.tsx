import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
