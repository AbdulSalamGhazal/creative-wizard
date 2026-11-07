import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import type { Delta } from "@/lib/period";
import { signedPct } from "@/lib/format";
import { Chip } from "@/components/ui/chip";

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
  vs,
  className = "",
}: {
  delta: Delta;
  inverted?: boolean;
  /** The baseline, `deltaVsLabel(...)` — "vs Oct 1 – Oct 7: $10,412". Shown
   *  as the chip's title and read after the figure (R-050). */
  vs?: string;
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
      <Chip
        size="sm"
        tone="pos"
        className={`gap-0.5 ${className}`}
        title="No spend in the prior window — this is new activity."
      >
        <Sparkles />
        New
      </Chip>
    );
  }

  if (delta.mode === "removed") {
    return (
      <Chip
        size="sm"
        tone="neg"
        className={`gap-0.5 ${className}`}
        title="Activity in the prior window, none in the current."
      >
        <ArrowDownRight />
        Gone
      </Chip>
    );
  }

  // mode === "pct"
  const pct = delta.pct ?? 0;
  const up = pct >= 0;
  const good = inverted ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const formatted = signedPct(pct);

  return (
    <Chip size="sm" tone={good ? "pos" : "neg"} className={`gap-0.5 tabular-nums ${className}`} title={vs}>
      <Icon />
      {formatted}
      {vs && <span className="sr-only"> {vs}</span>}
    </Chip>
  );
}
