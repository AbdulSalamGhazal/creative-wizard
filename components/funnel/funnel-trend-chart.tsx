"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { pct, monthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SeriesLegend } from "@/components/charts/series-legend";
import { ChartHeader, ChartShell, ExpandButton, SmoothToggle } from "@/components/charts/chart-shell";
import { smoothColumns } from "@/lib/chart-smooth";
import { FUNNEL_METRIC_COLOR } from "@/lib/palette";
import type { FunnelDailyPoint } from "@/db/queries/funnel";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

type MetricKey = "ctr" | "voc" | "atcRate" | "apRate" | "purchaseRate" | "cvr";

const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "ctr", label: "CTR", color: FUNNEL_METRIC_COLOR.ctr },
  { key: "voc", label: "VOC", color: FUNNEL_METRIC_COLOR.voc },
  { key: "atcRate", label: "ATC", color: FUNNEL_METRIC_COLOR.atcRate },
  { key: "apRate", label: "AP", color: FUNNEL_METRIC_COLOR.apRate },
  { key: "purchaseRate", label: "CvR (AP)", color: FUNNEL_METRIC_COLOR.purchaseRate },
  { key: "cvr", label: "CvR (LP)", color: FUNNEL_METRIC_COLOR.cvr },
];

const FIXED_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

interface Row {
  date: string;
  [k: string]: number | string | null;
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
  const displayData = useMemo<Row[]>(
    () =>
      smooth
        ? smoothColumns(data, METRICS.flatMap((m) => [m.key, `${m.key}_prev`]))
        : data,
    [data, smooth],
  );

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

  const header = (inFull: boolean, toggleExpand: () => void) => (
    <ChartHeader
      title="Funnel rates over time"
      controls={
        <>
          <SmoothToggle on={smooth} onToggle={() => setSmooth((v) => !v)} />
          <button
            type="button"
            onClick={() => setCompare((v) => !v)}
            aria-pressed={compare}
            title="Overlay the prior period (dashed)"
            className={cn(
              "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors",
              compare
                ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
                : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
            )}
          >
            vs prev period
          </button>
          <ExpandButton inFull={inFull} onClick={toggleExpand} />
        </>
      }
    />
  );

  const legend = (
    <SeriesLegend
      items={METRICS.map((m) => ({ key: m.key, label: m.label, color: m.color }))}
      shown={shown}
      onToggle={(k) => toggle(k as MetricKey)}
      onShowAll={() => setShown(new Set(METRICS.map((m) => m.key)))}
    />
  );

  const chart = (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={displayData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => monthDay(d)}
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
            // No connectNulls: a no-data day carries null rates and the line
            // must break there rather than plot a fabricated 0%.
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
    <ChartShell ariaLabel="Funnel rates over time — expanded" legend={legend}>
      {({ inFull, toggleExpand }) => (
        <>
          {header(inFull, toggleExpand)}
          <div className={inFull ? "flex-1 min-h-0" : "h-80"}>
            {data.length === 0 ? emptyState : chart}
          </div>
        </>
      )}
    </ChartShell>
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
    <ChartTooltip>
      <div className="text-ink-2 mb-1.5">{monthDay(label)}</div>
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
    </ChartTooltip>
  );
}
