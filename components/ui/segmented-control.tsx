"use client";

import { cn } from "@/lib/utils";

/**
 * The one segmented control: a small row of mutually-exclusive options in a
 * bordered tray. Three copies of this markup had grown independently (the chart
 * MetricPicker, Reconciliation's mode toggle, Budget's currency toggle) and had
 * already drifted on tray colour and height.
 *
 * Rendered as a tablist because that is what it is — each option swaps what the
 * panel below shows, and `aria-selected` is how a screen reader conveys which
 * one is live.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  /** `disabled` renders the option visibly unavailable; `title` says why. */
  options: ReadonlyArray<{
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
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
          aria-disabled={o.disabled || undefined}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 h-7 rounded transition-colors whitespace-nowrap",
            value === o.value ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
            // An unavailable option stays readable but visibly out of reach —
            // hiding it would leave the reader wondering where it went.
            o.disabled && "cursor-not-allowed opacity-40 hover:text-ink-3",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
