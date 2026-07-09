"use client";

import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";

/**
 * The canonical line-chart frame: a bordered card that can expand to a
 * fullscreen overlay (Esc or the close button exits). The render prop is called
 * once for the inline card and again inside the overlay; `inFull` lets the chart
 * grow its height (`flex-1` vs a fixed height) and swap the expand/close icon.
 * One implementation instead of each chart re-coding the overlay.
 */
export function ChartShell({
  ariaLabel,
  legend,
  children,
}: {
  ariaLabel?: string;
  /**
   * Series legends render below the plot — do not place SeriesLegend in a
   * chart's header zone. Passed here, the shell drops it under the plot in both
   * the inline card and the fullscreen overlay.
   */
  legend?: React.ReactNode;
  children: (ctx: {
    inFull: boolean;
    expanded: boolean;
    toggleExpand: () => void;
  }) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const toggleExpand = () => setExpanded((v) => !v);

  return (
    <>
      <div className="rounded-lg border border-line bg-surface p-4">
        {children({ inFull: false, expanded, toggleExpand })}
        {legend && <div className="mt-3">{legend}</div>}
      </div>
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm p-3 sm:p-6 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
        >
          <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-line bg-surface p-4 shadow-2xl">
            {children({ inFull: true, expanded, toggleExpand })}
            {legend && <div className="mt-3">{legend}</div>}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The canonical line-chart header row: Title → MetricPicker → right-aligned
 * control cluster (Group → Smooth → Expand, whichever the chart has). Do not
 * hand-roll a chart header — every ChartShell chart uses this so titles read
 * identically everywhere (`text-sm font-medium text-ink`, sentence case) and
 * the plot's top edge never varies. Series legends do NOT belong here — pass
 * them to ChartShell's `legend` slot (below the plot).
 */
export function ChartHeader({
  title,
  picker,
  controls,
}: {
  title: string;
  /** MetricPicker (or an equivalent segmented control), after the title. */
  picker?: React.ReactNode;
  /** Right-aligned cluster: Group → Smooth → Expand. */
  controls?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap mb-2">
      <h3 className="text-sm font-medium text-ink shrink-0">{title}</h3>
      {picker}
      {controls && (
        <div className="ml-auto flex items-center gap-2">{controls}</div>
      )}
    </div>
  );
}

/** The expand / close icon button — pair with ChartShell's `toggleExpand`. */
export function ExpandButton({
  inFull,
  onClick,
}: {
  inFull: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={inFull ? "Close expanded view" : "Expand to full screen"}
      title={inFull ? "Close (Esc)" : "Expand"}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-line text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
    >
      {inFull ? <X className="w-4 h-4" /> : <Maximize2 className="w-3.5 h-3.5" />}
    </button>
  );
}

/** The "Smooth" (moving average) toggle — pairs with lib/chart-smooth. */
export function SmoothToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title="Smooth out day-to-day noise (7-day moving average)"
      className={
        "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors " +
        (on
          ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
          : "border-line text-ink-2 hover:text-ink hover:bg-surface-2")
      }
    >
      Smooth
    </button>
  );
}

/** The "Group" toggle — collapse the shown series into one combined line. */
export function GroupToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title="Combine the shown series into a single total line"
      className={
        "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors " +
        (on
          ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
          : "border-line text-ink-2 hover:text-ink hover:bg-surface-2")
      }
    >
      Group
    </button>
  );
}
