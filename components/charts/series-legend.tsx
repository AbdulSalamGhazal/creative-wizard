"use client";

import { cn } from "@/lib/utils";

/**
 * The canonical chart legend for togglable series — a row of colored chips you
 * click to show/hide a line. One look everywhere (funnel rate lines, campaign
 * creative lines, etc.) instead of each chart re-implementing the chip.
 */
export function SeriesLegend({
  items,
  shown,
  onToggle,
  className,
}: {
  items: ReadonlyArray<{ key: string; label: string; color: string }>;
  shown: ReadonlySet<string>;
  onToggle: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((it) => {
        const on = shown.has(it.key);
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onToggle(it.key)}
            aria-pressed={on}
            title={it.label}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] max-w-[14rem] transition-colors",
              on
                ? "border-line bg-surface-2 text-ink"
                : "border-line text-ink-3 hover:text-ink line-through opacity-60",
            )}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: it.color }}
            />
            <span className="truncate">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
