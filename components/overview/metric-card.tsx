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
 * One Dashboard metric: a labeled headline figure with an icon, and a compact
 * per-dimension breakdown below it (horizontal bars). Presentational only —
 * all metric math + bar fractions are computed by the caller.
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
    <div className="rounded-xl border border-line bg-surface p-5 flex flex-col gap-4">
      {/* Headline */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-ink-3">
            {label}
          </div>
          <div className="font-display text-[2.75rem] leading-none num text-ink mt-1.5">
            {value}
          </div>
        </div>
        <span className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg bg-[var(--brand-soft)] text-brand">
          <Icon className="h-4 w-4" />
        </span>
      </div>

      {/* Breakdown */}
      {bars.length === 0 ? (
        <p className="text-[11px] text-ink-3 italic">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {bars.map((b) => (
            <li key={b.key} className="flex items-center gap-2 text-[11px]">
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: b.color }}
              />
              <span className="truncate text-ink-3 w-16 shrink-0" title={b.label}>
                {b.label}
              </span>
              <span className="h-1 flex-1 rounded-full bg-surface-2 overflow-hidden">
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
