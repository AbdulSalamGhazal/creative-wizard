"use client";

import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * The canonical line-chart frame: a bordered card that can expand to a
 * fullscreen overlay (Esc or the close button exits). The render prop is called
 * once for the inline card and again inside the overlay; `inFull` lets the chart
 * grow its height (`flex-1` vs a fixed height) and swap the expand/close icon.
 * One implementation instead of each chart re-coding the overlay.
 */
export function ChartShell({
  ariaLabel,
  summary,
  legend,
  children,
}: {
  ariaLabel?: string;
  /**
   * What the chart shows, in words (R-022, 2026-11): the inline card's
   * accessible name and an sr-only caption, so a screen reader hears more
   * than an unlabelled SVG. The chart roots carry Recharts'
   * `accessibilityLayer`, so arrow keys walk the points through the tooltip.
   */
  summary: string;
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
  const toggleExpand = () => setExpanded((v) => !v);

  return (
    <>
      <div role="figure" aria-label={summary} className="rounded-lg border border-line bg-surface p-4">
        <p className="sr-only">{summary}</p>
        {children({ inFull: false, expanded, toggleExpand })}
        {legend && <div className="mt-3">{legend}</div>}
      </div>
      {/* The expanded view is the HOUSE Dialog (R-020): focus moves in and is
          trapped there, Escape closes, the page behind can't scroll, and focus
          returns to the Expand button on close — the hand-rolled overlay did
          none of that but Escape. */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="flex h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-none flex-col gap-0 border-line bg-surface p-4 shadow-2xl sm:max-w-none sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)]"
        >
          <DialogTitle className="sr-only">{ariaLabel ?? "Chart"}</DialogTitle>
          {expanded && children({ inFull: true, expanded, toggleExpand })}
          {legend && <div className="mt-3">{legend}</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The plot area's height — one ladder for every chart (R-023, 2026-11), so the
 * same chart role is the same height on every page and shorter on a phone:
 * `lg` for a page's primary over-time chart, `md` for a secondary card. In
 * the fullscreen overlay the plot fills the frame.
 */
export const CHART_PLOT = { md: "h-56 sm:h-64", lg: "h-64 sm:h-80" } as const;
export function plotClass(inFull: boolean, size: keyof typeof CHART_PLOT = "lg"): string {
  return inFull ? "flex-1 min-h-0" : CHART_PLOT[size];
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
          ? "border-brand/50 bg-brand-soft text-ink"
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
          ? "border-brand/50 bg-brand-soft text-ink"
          : "border-line text-ink-2 hover:text-ink hover:bg-surface-2")
      }
    >
      Group
    </button>
  );
}
