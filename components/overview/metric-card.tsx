import type { ComponentType } from "react";

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
 * One Dashboard metric, laid out horizontally: a large headline figure on the
 * left and a narrow per-dimension breakdown (labeled bars) on the right.
 * Presentational only — all metric math + bar fractions come from the caller.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  bars,
  emptyText = "No data in range.",
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  bars: BreakdownBar[];
  emptyText?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 flex items-center justify-between gap-4">
      {/* Left: headline */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-ink-3">
          <Icon className="h-3 w-3" />
          <span>{label}</span>
        </div>
        <div className="font-display text-4xl leading-none num text-ink mt-2.5 whitespace-nowrap">
          {value}
        </div>
      </div>

      {/* Right: narrow breakdown */}
      <div className="w-32 shrink-0">
        {bars.length === 0 ? (
          <p className="text-[11px] text-ink-3 italic">{emptyText}</p>
        ) : (
          <ul className="space-y-1.5">
            {bars.map((b) => (
              <li key={b.key} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: b.color }}
                    />
                    <span className="truncate text-ink-3" title={b.label}>
                      {b.label}
                    </span>
                  </span>
                  <span className="num text-ink-2 shrink-0 tabular-nums">
                    {b.display}
                  </span>
                </div>
                <span className="block h-1 w-full rounded-full bg-surface-2 overflow-hidden">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(2, Math.min(100, b.fraction * 100))}%`,
                      background: b.color,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
