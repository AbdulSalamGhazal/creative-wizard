import type { ComponentType, ReactNode } from "react";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import type { Delta } from "@/lib/period";
import { cn } from "@/lib/utils";

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

/** The tile frame, shared with its skeletons so a stream-in never jumps. */
export function metricCardFrame(
  variant: "card" | "quiet" = "card",
  size: "md" | "sm" = "md",
): string {
  return cn(
    // Radius scale (R-089): a tile is lg, a tile nested in a card is md.
    "@container min-w-0 flex flex-col",
    variant === "quiet" ? "rounded-md bg-surface-2/60" : "rounded-lg border border-line bg-surface",
    size === "sm" ? "p-3 gap-2.5" : "p-4 gap-3.5",
  );
}

/**
 * The app's ONE KPI / stat tile (R-010): a label, a big headline figure and
 * whatever the metric adds below it. Every "label + big number" surface uses
 * it — the Dashboard and Store tiles, Budget's hero cards (via `Hero`), the
 * Funnel rate tiles, Trends' stat tiles and the upload summary — so a tile
 * looks the same on every page. Presentational only — all metric math + bar
 * fractions are computed by the caller.
 *
 * - `variant="quiet"` is the borderless `surface-2` fill for a tile nested
 *   INSIDE a card (the Dashboard's Funnel rates).
 * - `size="sm"` is the inline stat (tighter padding, smaller figure).
 * - The label is always `text-label text-ink-3`; the value is always sized
 *   through `displayValueFontSize`, so it never leaves the tile at 375px.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  dot,
  bars = [],
  delta,
  deltaInverted = false,
  deltaVs,
  aside,
  caption,
  emptyText = "No data in this range.",
  footer,
  hideBreakdown = false,
  empty = false,
  variant = "card",
  size = "md",
  valueTitle,
  figure,
  children,
}: {
  label: string;
  value: string;
  /** The label's icon. Omit for a plain label (or pass `dot`). */
  icon?: ComponentType<{ className?: string }>;
  /** A colour marker before the label instead of an icon (the funnel rates). */
  dot?: string;
  bars?: BreakdownBar[];
  /** Period-over-period change vs the previous equal window. */
  delta?: Delta;
  /** Lower-is-better metric (e.g. CPA) → flip the badge color semantics. */
  deltaInverted?: boolean;
  /** The delta's baseline for its title / sr-only text (`deltaVsLabel`). */
  deltaVs?: string;
  /** Anything else for the header's right side (an order count, "planned"). */
  aside?: ReactNode;
  /** One context line right under the figure ("of $12,000 + $600 reserve"). */
  caption?: ReactNode;
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
  /** `card` (bordered, default) or `quiet` (borderless fill, nested in a card). */
  variant?: "card" | "quiet";
  /** `md` (default) or `sm` (the inline stat: tighter padding, smaller figure). */
  size?: "md" | "sm";
  /** Hover text for the figure (e.g. the exact value behind a rounded one). */
  valueTitle?: string;
  /**
   * A composite figure (several coloured counts, each with its word) drawn in
   * place of `value`, which still names the figure for sizing. It wraps
   * instead of shrinking.
   */
  figure?: ReactNode;
  /** Rich content under the figure — Budget's pace bar + verdict, a sparkline. */
  children?: ReactNode;
}) {
  const hasCaption = caption !== null && caption !== undefined && caption !== "";
  return (
    <div className={metricCardFrame(variant, size)}>
      {/* Headline */}
      <div>
        {/* In a phone's two-column grid the header is ~124px, and
            "CONVERSIONS" (~119px) beside any delta chip ran the chip out of
            the tile and the page sideways (W3, 375px). A narrow tile stacks
            the chip under the label — EVERY narrow tile, so the values in a
            row stay level; a wider one keeps them side by side. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 @max-[12rem]:flex-col @max-[12rem]:items-start">
          <div className="flex min-w-0 max-w-full items-center gap-1.5 text-label text-ink-3">
            {dot ? (
              <span
                aria-hidden
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: dot }}
              />
            ) : Icon ? (
              <Icon className="h-3.5 w-3.5 shrink-0" />
            ) : null}
            <span className="truncate" title={label}>{label}</span>
          </div>
          {aside}
          {delta && !empty ? (
            <DeltaBadge delta={delta} inverted={deltaInverted} vs={deltaVs} />
          ) : null}
        </div>
        {figure ? (
          <div className={cn(size === "sm" ? "mt-1.5" : "mt-2")} title={valueTitle}>
            {figure}
          </div>
        ) : (
          <div
            className={cn(
              "font-display leading-none tabular-nums text-ink whitespace-nowrap",
              size === "sm" ? "mt-1.5" : "mt-2",
            )}
            style={{
              fontSize: displayValueFontSize(value, size === "sm" ? "1.6rem" : "2.6rem"),
            }}
            title={valueTitle}
          >
            {value}
          </div>
        )}
        {hasCaption && <p className="mt-1 text-xs text-ink-3">{caption}</p>}
        {children}
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
              {/* A narrow tile (five abreast at lg, two on a phone) can't
                  hold label + bar + value: the bar goes and the label
                  truncates, so the value stays inside the tile. */}
              <span
                className="truncate text-ink-3 w-[4.5rem] min-w-0"
                title={b.label}
              >
                {b.label}
              </span>
              <span className="h-1.5 flex-1 rounded-full bg-surface-2 overflow-hidden @max-[9rem]:hidden">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, b.fraction * 100))}%`,
                    background: b.color,
                  }}
                />
              </span>
              <span className="text-ink-2 shrink-0 tabular-nums ml-auto">
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
