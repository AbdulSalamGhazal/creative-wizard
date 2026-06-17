"use client";

import { cn } from "@/lib/utils";
import {
  RATING_WINDOWS,
  RATING_WINDOW_LABEL,
  type RatingWindow,
} from "@/lib/rating";

const HINT: Record<RatingWindow, string> = {
  "7d": "Rate creatives over the selected range + the 7 days before it",
  "30d": "Rate creatives over the selected range + the 30 days before it",
  life: "Rate creatives over all history up to the range end",
  none: "Rate creatives over the selected range only",
};

/**
 * Picks the lookback window used to RATE creatives in "Spend by rating" (the
 * displayed spend always tracks the selected range). Pure controlled state — the
 * parent has every window pre-computed, so switching is instant (no reload).
 */
export function RatingWindowControl({
  value,
  onChange,
  className,
}: {
  value: RatingWindow;
  onChange: (w: RatingWindow) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5",
        className,
      )}
      title="Rating lookback window"
    >
      {RATING_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          title={HINT[w]}
          aria-pressed={value === w}
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-medium leading-none transition-colors",
            value === w ? "bg-brand/15 text-brand" : "text-ink-3 hover:text-ink",
          )}
        >
          {RATING_WINDOW_LABEL[w]}
        </button>
      ))}
    </div>
  );
}
