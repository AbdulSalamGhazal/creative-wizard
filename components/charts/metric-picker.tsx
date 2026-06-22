"use client";

import { cn } from "@/lib/utils";

/**
 * The canonical single-metric picker for charts — a segmented control that
 * wraps when there are many options. One look everywhere (replaces the mix of
 * native <select>, shadcn <Select>, and ad-hoc segmented controls that charts
 * grew independently).
 */
export function MetricPicker<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Metric",
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5 text-[11px]",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 h-7 rounded transition-colors whitespace-nowrap",
            value === o.value ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
