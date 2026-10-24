/**
 * Tiny inline SVG sparkline. Stays a Server Component (no DOM measurement
 * needed); plain SVG keeps the Library/Overview bundle slim.
 */
interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Stroke color (CSS). Defaults to brand. */
  color?: string;
  /** Render the area under the line too. */
  filled?: boolean;
  /**
   * Y-axis baseline. "zero" (default) anchors the scale at 0 — good for spend.
   * "data" scales to the values' own min/max — use for small, tightly-ranged
   * rates (CTR/CvR) so their variation is visible instead of squashed.
   */
  baseline?: "zero" | "data";
  /**
   * Stretch to the parent's width instead of a fixed `width`. `width` is then
   * just the logical viewBox width; the SVG scales via `preserveAspectRatio`
   * and the stroke stays crisp (non-scaling). Height stays fixed.
   */
  responsive?: boolean;
  /**
   * A second series drawn DASHED under the first — the plan behind the actual
   * (Budget's board, 2026-10-19). Both share one y-scale, so a day over plan
   * reads above the dashed line; the x-axis spans the longer series, so
   * `values` may stop short (actual ends at coverage) while the comparison
   * runs to the end.
   */
  compare?: number[];
  /** The comparison's stroke. Defaults to the muted ink. */
  compareColor?: string;
}

export function Sparkline({
  values,
  width = 80,
  height = 22,
  color = "var(--brand)",
  filled = true,
  baseline = "zero",
  responsive = false,
  compare,
  compareColor = "var(--ink-3)",
}: Props) {
  if (values.length === 0 && (compare === undefined || compare.length === 0)) {
    return (
      <span
        className="inline-block max-w-full text-[10px] text-ink-3"
        // A responsive line stretches to its parent, so its "no data" dash
        // must too — a fixed 200px dash pushed a 375px Funnel page wide.
        style={{ width: responsive ? "100%" : width, height, lineHeight: `${height}px` }}
      >
        —
      </span>
    );
  }

  // One scale for both series — the comparison is the yardstick the values
  // are read against, so it must share their axis.
  const all = compare ? [...values, ...compare] : values;
  const max = baseline === "data" ? Math.max(...all) : Math.max(...all, 0);
  const min = baseline === "data" ? Math.min(...all) : Math.min(...all, 0);
  // "data" baseline can hold tiny fractions (CTR/CvR ~0.02); flooring the span at
  // 1 would collapse all their variation into a flat line, so use the true range
  // there and only guard against a zero span (all values identical). "zero"
  // baseline keeps the 1 floor — its values are counts/dollars and the floor
  // suppresses noise near zero.
  const span =
    baseline === "data" ? (max > min ? max - min : 1) : Math.max(max - min, 1);
  const pad = 1.5; // px breathing room at the top/bottom so the line never touches the edge

  // Even for a single point, draw a flat baseline so the row still feels alive.
  const points = values.length === 1 ? [values[0]!, values[0]!] : values;
  // The x-axis spans the LONGER series: a comparison that runs past the
  // values keeps its own step, and the values stop where they stop.
  const axisPoints = Math.max(points.length, compare?.length ?? 0);
  const stepX = axisPoints > 1 ? (width - 2 * pad) / (axisPoints - 1) : 0;
  const toPath = (series: number[]) =>
    series
      .map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + (1 - (v - min) / span) * (height - 2 * pad);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const linePath = points.length > 0 ? toPath(points) : null;
  const comparePath =
    compare && compare.length > 0
      ? toPath(compare.length === 1 ? [compare[0]!, compare[0]!] : compare)
      : null;

  const areaPath =
    filled && linePath
      ? `${linePath} L${(pad + stepX * (points.length - 1)).toFixed(2)},${(height - pad).toFixed(2)} L${pad.toFixed(2)},${(height - pad).toFixed(2)} Z`
      : null;

  return (
    <svg
      width={responsive ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={responsive ? "none" : "xMidYMid meet"}
      className="overflow-visible"
      aria-hidden
    >
      {areaPath && (
        <path
          d={areaPath}
          fill={color}
          fillOpacity={0.15}
          stroke="none"
        />
      )}
      {comparePath && (
        <path
          d={comparePath}
          fill="none"
          stroke={compareColor}
          strokeWidth={1.1}
          strokeDasharray="3 2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect={responsive ? "non-scaling-stroke" : undefined}
        />
      )}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect={responsive ? "non-scaling-stroke" : undefined}
        />
      )}
    </svg>
  );
}
