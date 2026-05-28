import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import type { Delta } from "@/lib/period";

/**
 * Renders a single period-over-period delta as a small inline badge.
 *
 * Color semantics:
 *  - `inverted = false` (default): ↑ pct ≥ 0 → positive (green), ↑ < 0 → negative (red).
 *     Use for spend (growth), impressions, conversions, CTR, ROAS, hookRate.
 *  - `inverted = true`: flipped. Use for CPA, CPM, CPC — lower is better.
 *
 * Modes other than "pct" override the color entirely.
 */
export function DeltaBadge({
  delta,
  inverted = false,
  className = "",
}: {
  delta: Delta;
  inverted?: boolean;
  className?: string;
}) {
  if (delta.mode === "absent") {
    return (
      <span className={`text-[10px] text-ink-3 ${className}`} aria-hidden>
        —
      </span>
    );
  }

  if (delta.mode === "new") {
    return (
      <span
        className={`inline-flex items-center gap-0.5 h-4 px-1 rounded text-[10px] border border-pos/40 bg-pos/10 text-pos ${className}`}
        title="No spend in the prior window — this is new activity."
      >
        <Sparkles className="w-2.5 h-2.5" />
        New
      </span>
    );
  }

  if (delta.mode === "removed") {
    return (
      <span
        className={`inline-flex items-center gap-0.5 h-4 px-1 rounded text-[10px] border border-neg/40 bg-neg/10 text-neg ${className}`}
        title="Activity in the prior window, none in the current."
      >
        <ArrowDownRight className="w-2.5 h-2.5" />
        Gone
      </span>
    );
  }

  // mode === "pct"
  const pct = delta.pct ?? 0;
  const up = pct >= 0;
  const good = inverted ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const color = good
    ? "border-pos/40 bg-pos/10 text-pos"
    : "border-neg/40 bg-neg/10 text-neg";
  const sign = up ? "+" : "";
  const formatted = `${sign}${(pct * 100).toFixed(1)}%`;

  return (
    <span
      className={`inline-flex items-center gap-0.5 h-4 px-1 rounded text-[10px] border tabular-nums ${color} ${className}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {formatted}
    </span>
  );
}
