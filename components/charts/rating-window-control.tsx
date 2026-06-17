"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
 * displayed spend always tracks the selected range). Writes the `rw` URL param
 * — default `7d` stays out of the URL — which re-renders the dashboard.
 */
export function RatingWindowControl({ value }: { value: RatingWindow }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const select = (w: RatingWindow) => {
    if (w === value) return;
    const next = new URLSearchParams(params.toString());
    if (w === "7d") next.delete("rw");
    else next.set("rw", w);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5"
      title="Rating lookback window"
    >
      {RATING_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => select(w)}
          title={HINT[w]}
          aria-pressed={value === w}
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-medium leading-none transition-colors",
            value === w
              ? "bg-brand/15 text-brand"
              : "text-ink-3 hover:text-ink",
          )}
        >
          {RATING_WINDOW_LABEL[w]}
        </button>
      ))}
    </div>
  );
}
