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
}

export function Sparkline({
  values,
  width = 80,
  height = 22,
  color = "var(--brand)",
  filled = true,
  baseline = "zero",
}: Props) {
  if (values.length === 0) {
    return (
      <span
        className="inline-block text-[10px] text-ink-3"
        style={{ width, height, lineHeight: `${height}px` }}
      >
        —
      </span>
    );
  }

  const max = baseline === "data" ? Math.max(...values) : Math.max(...values, 0);
  const min = baseline === "data" ? Math.min(...values) : Math.min(...values, 0);
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
  const stepX = points.length > 1 ? (width - 2 * pad) / (points.length - 1) : 0;

  const coords = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - 2 * pad);
    return { x, y };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");

  const areaPath = filled
    ? `${linePath} L${(pad + stepX * (points.length - 1)).toFixed(2)},${(height - pad).toFixed(2)} L${pad.toFixed(2)},${(height - pad).toFixed(2)} Z`
    : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
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
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
