import type { ComponentType, ReactNode } from "react";
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
 * A headline figure's size: `max` normally, stepped down only as far as the
 * card is actually too narrow for the string. A wide figure — `SAR 999,999.00`
 * in Budget's SAR mode — needs ~216px at 2.6rem, but a two-column card at 375px
 * offers ~124px, so it used to clip.
 *
 * `100cqi` is the card's own content width, so the caller must give the card
 * `@container` (the query box already excludes its padding). The divisor is the
 * string's width in ems: Instrument Serif has no tabular figures, so glyphs vary
 * (a `1` is 0.25em, a `%` 0.59em), and 0.42em/char is an upper bound for the
 * long, digit-and-separator-heavy strings that are the only ones at risk —
 * short wide ones like `0%` average more but are nowhere near filling a card.
 * Because it's a `min()`, anything that already fits still renders at exactly
 * `max`: every value that wasn't clipping is pixel-identical, at every width.
 */
export function displayValueFontSize(value: string, max = "2.6rem"): string {
  const ems = Math.max(1, value.length) * 0.42;
  return `min(${max}, 100cqi / ${ems.toFixed(2)})`;
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
  footer,
  hideBreakdown = false,
  empty = false,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  bars?: BreakdownBar[];
  /** Period-over-period change vs the previous equal window. */
  delta?: Delta;
  /** Lower-is-better metric (e.g. CPA) → flip the badge color semantics. */
  deltaInverted?: boolean;
  /** Subline under the headline when there are no bars (string or rich node —
   *  Budget stacks a plan line + a projection line here). */
  emptyText?: ReactNode;
  /**
   * A caption under the card — a projection, a plan line, anything that isn't
   * the breakdown. Budget used to smuggle these through `emptyText`, which only
   * renders when `bars` is empty and is styled as an italic "no data" note.
   */
  footer?: ReactNode;
  /** Render only the headline + delta (no per-dimension breakdown). */
  hideBreakdown?: boolean;
  /**
   * No data in the current range. Suppresses the delta chip — a red "Gone"
   * or any % change next to an empty "—" value reads as an error, not signal.
   */
  empty?: boolean;
}) {
  return (
    <div className="@container min-w-0 rounded-xl border border-line bg-surface p-4 flex flex-col gap-3.5">
      {/* Headline */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-label text-ink-3">
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </div>
          {delta && !empty ? (
            <DeltaBadge delta={delta} inverted={deltaInverted} />
          ) : null}
        </div>
        <div
          className="font-display leading-none num text-ink mt-2 whitespace-nowrap"
          style={{ fontSize: displayValueFontSize(value) }}
        >
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
      {footer && <div className="text-[11px] text-ink-3">{footer}</div>}
    </div>
  );
}
