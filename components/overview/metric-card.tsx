import type { ComponentType } from "react";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import type { Delta } from "@/lib/period";

export interface BreakdownBar {
  key: string;
  label: string;
  color: string;
  /** Bar fill, 0..1. Share of total (share mode) or value/max (value mode). */
  fraction: number;
  /** Right-aligned figure (already formatted). */
  display: string;
}

/**
 * One Dashboard metric: a large headline figure with an icon, and a compact
 * per-dimension breakdown below it (labeled bars). Presentational only — all
 * metric math + bar fractions are computed by the caller.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  bars = [],
  delta,
  deltaInverted = false,
  emptyText = "No data in range.",
  hideBreakdown = false,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  bars?: BreakdownBar[];
  /** Period-over-period change vs the previous equal window. */
  delta?: Delta;
  /** Lower-is-better metric (e.g. CPA) → flip the badge color semantics. */
  deltaInverted?: boolean;
  emptyText?: string;
  /** Render only the headline + delta (no per-dimension breakdown). */
  hideBreakdown?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3.5">
      {/* Headline */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-ink-3">
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </div>
          {delta ? <DeltaBadge delta={delta} inverted={deltaInverted} /> : null}
        </div>
        <div className="font-display text-[2.6rem] leading-none num text-ink mt-2 whitespace-nowrap">
          {value}
        </div>
      </div>

      {/* Breakdown */}
      {hideBreakdown ? null : bars.length === 0 ? (
        <p className="text-xs text-ink-3 italic">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {bars.map((b) => (
            <li key={b.key} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: b.color }}
              />
              <span
                className="truncate text-ink-3 w-[4.5rem] shrink-0"
                title={b.label}
              >
                {b.label}
              </span>
              <span className="h-1.5 flex-1 rounded-full bg-surface-2 overflow-hidden">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, b.fraction * 100))}%`,
                    background: b.color,
                  }}
                />
              </span>
              <span className="num text-ink-2 shrink-0 tabular-nums">
                {b.display}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
