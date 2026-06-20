"use client";

import { useEffect, useMemo, useState } from "react";
import { Maximize2, X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FunnelDailyPoint } from "@/db/queries/funnel";

type MetricKey = "ctr" | "voc" | "atcRate" | "apRate" | "purchaseRate" | "cvr";

const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "ctr", label: "CTR", color: "#60A5FA" },
  { key: "voc", label: "VOC", color: "#34D399" },
  { key: "atcRate", label: "ATC", color: "#22D3EE" },
  { key: "apRate", label: "AP", color: "#F472B6" },
  { key: "purchaseRate", label: "CvR (AP)", color: "#FB923C" },
  { key: "cvr", label: "CvR (LP)", color: "#A78BFA" },
];

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const FIXED_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** Centered moving-average half-window (±3 → a 7-day window) used by Smooth. */
const SMOOTH_HALF = 3;

interface Row {
  date: string;
  [k: string]: number | string | null;
}

/**
 * Centered moving average for one column: each point becomes the mean of the
 * non-null values within ±SMOOTH_HALF. Null stays null (a gap, not invented),
 * so `connectNulls` still bridges missing days the same way.
 */
function smoothColumn(rows: Row[], key: string): Array<number | null> {
  return rows.map((row, i) => {
    if (typeof row[key] !== "number") return null;
    let sum = 0;
    let n = 0;
    const lo = Math.max(0, i - SMOOTH_HALF);
    const hi = Math.min(rows.length - 1, i + SMOOTH_HALF);
    for (let j = lo; j <= hi; j++) {
      const v = rows[j]?.[key];
      if (typeof v === "number") {
        sum += v;
        n += 1;
      }
    }
    return n > 0 ? sum / n : null;
  });
}

/**
 * Funnel conversion-rates over time. Every funnel step plots as a line; click a
 * legend chip to toggle a line off. With 2+ metrics shown the Y-axis is pinned
 * to an even 0–100% so a high-value rate can't squash the others (values above
 * 100% are clipped — inspect them via the tooltip / expanded view); a single
 * metric auto-scales to its own range. "vs prev" overlays the prior equal-length
 * window as dashed lines. Expand fills the screen, keeping all the toggles.
 */
export function FunnelTrendChart({
  points,
  prevPoints,
}: {
  points: FunnelDailyPoint[];
  prevPoints: FunnelDailyPoint[];
}) {
  const [shown, setShown] = useState<Set<MetricKey>>(
    () => new Set(METRICS.map((m) => m.key)),
  );
  const [compare, setCompare] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Close the expanded view on Escape.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const data = useMemo<Row[]>(
    () =>
      points.map((cur, i) => {
        const prv = prevPoints[i];
        const row: Row = { date: cur.date };
        for (const m of METRICS) {
          row[m.key] = cur[m.key];
          row[`${m.key}_prev`] = prv ? prv[m.key] : null;
        }
        return row;
      }),
    [points, prevPoints],
  );

  // When Smooth is on, replace every metric column (and its _prev) with its
  // moving average so day-to-day noise flattens into the underlying trend.
  const displayData = useMemo<Row[]>(() => {
    if (!smooth) return data;
    const keys = METRICS.flatMap((m) => [m.key, `${m.key}_prev`]);
    const cols = new Map(keys.map((k) => [k, smoothColumn(data, k)]));
    return data.map((row, i) => {
      const next: Row = { date: row.date };
      for (const k of keys) next[k] = cols.get(k)?.[i] ?? null;
      return next;
    });
  }, [data, smooth]);

  const toggle = (k: MetricKey) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const visible = METRICS.filter((m) => shown.has(m.key));
  // 2+ metrics → pin the axis so one tall rate doesn't flatten the rest.
  const fixedAxis = visible.length > 1;

  const header = (inFull: boolean) => (
    <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
      <div>
        <h3 className="text-sm text-ink-2">Funnel rates over time</h3>
        <p className="text-[10px] text-ink-3">
          Click a metric to hide it. Toggle &ldquo;vs prev&rdquo; to overlay the
          prior period (dashed).
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setSmooth((v) => !v)}
          aria-pressed={smooth}
          title="Smooth out day-to-day noise (7-day moving average)"
          className={cn(
            "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors",
            smooth
              ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
              : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
          )}
        >
          Smooth
        </button>
        <button
          type="button"
          onClick={() => setCompare((v) => !v)}
          aria-pressed={compare}
          className={cn(
            "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors",
            compare
              ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
              : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
          )}
        >
          vs prev period
        </button>
        <button
          type="button"
          onClick={() => setExpanded(!inFull)}
          aria-label={inFull ? "Close expanded view" : "Expand to full screen"}
          title={inFull ? "Close (Esc)" : "Expand"}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-line text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
        >
          {inFull ? <X className="w-4 h-4" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );

  const legend = (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {METRICS.map((m) => {
        const on = shown.has(m.key);
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => toggle(m.key)}
            aria-pressed={on}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] transition-colors",
              on
                ? "border-line bg-surface-2 text-ink"
                : "border-line text-ink-3 hover:text-ink line-through opacity-60",
            )}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: m.color }}
            />
            {m.label}
          </button>
        );
      })}
    </div>
  );

  const chart = (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={displayData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => monthDay.format(new Date(d))}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          stroke="var(--line-2)"
          tickMargin={6}
          minTickGap={24}
        />
        <YAxis
          domain={fixedAxis ? [0, 1] : ["auto", "auto"]}
          ticks={fixedAxis ? FIXED_TICKS : undefined}
          allowDataOverflow={fixedAxis}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          stroke="var(--line-2)"
          width={44}
        />
        <Tooltip content={<FunnelTip visible={visible} compare={compare} />} />
        {visible.map((m) => (
          <Line
            key={m.key}
            type="monotone"
            dataKey={m.key}
            name={m.label}
            stroke={m.color}
            strokeWidth={1.8}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
        {compare &&
          visible.map((m) => (
            <Line
              key={`${m.key}_prev`}
              type="monotone"
              dataKey={`${m.key}_prev`}
              stroke={m.color}
              strokeWidth={1.4}
              strokeDasharray="4 3"
              strokeOpacity={0.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
      </LineChart>
    </ResponsiveContainer>
  );

  const emptyState = (
    <div className="h-full flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
      No data in this window.
    </div>
  );

  return (
    <>
      <div className="rounded-lg border border-line bg-surface p-4">
        {header(false)}
        {legend}
        <div className="h-80">{data.length === 0 ? emptyState : chart}</div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm p-3 sm:p-6 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Funnel rates over time — expanded"
        >
          <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-line bg-surface p-4 shadow-2xl">
            {header(true)}
            {legend}
            <div className="flex-1 min-h-0">
              {data.length === 0 ? emptyState : chart}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FunnelTip({
  active,
  label,
  payload,
  visible,
  compare,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; value: number | null }>;
  visible: Array<{ key: MetricKey; label: string; color: string }>;
  compare: boolean;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  const byKey = new Map(payload.map((p) => [p.dataKey, p.value]));
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-2 mb-1.5">{monthDay.format(new Date(label))}</div>
      <div className="space-y-1">
        {visible.map((m) => (
          <div key={m.key} className="flex items-center gap-2 min-w-[150px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: m.color }}
            />
            <span className="text-ink-2">{m.label}</span>
            <span className="ml-auto text-ink num">{pct(byKey.get(m.key) ?? null)}</span>
            {compare && (
              <span className="text-ink-3 num w-12 text-right">
                {pct(byKey.get(`${m.key}_prev`) ?? null)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
