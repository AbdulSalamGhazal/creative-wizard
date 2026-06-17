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
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useChartFit, ChartFitToggle } from "@/components/charts/chart-fit";
import type { FunnelDailyPoint } from "@/db/queries/funnel";

type Metric = "cpm" | "ctr" | "voc" | "cvr";

const METRICS: Record<
  Metric,
  { label: string; color: string; fmt: (v: number | null) => string }
> = {
  cpm: { label: "CPM", color: "#FBBF24", fmt: usd },
  ctr: { label: "CTR", color: "#60A5FA", fmt: pct },
  voc: { label: "VOC", color: "#34D399", fmt: pct },
  cvr: { label: "CvR", color: "#A78BFA", fmt: pct },
};
const ORDER: Metric[] = ["cpm", "ctr", "voc", "cvr"];

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function FunnelTrendChart({ points }: { points: FunnelDailyPoint[] }) {
  const [metric, setMetric] = useState<Metric>("ctr");
  const m = METRICS[metric];
  const hasData = points.some((p) => p[metric] != null);

  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const p of points) {
      const v = p[metric];
      if (typeof v === "number") out.push(v);
    }
    return out;
  }, [points, metric]);
  const fit = useChartFit(yValues);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm text-ink-2">{m.label} over time</h3>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={cn(
                "px-2.5 h-7 rounded transition-colors",
                metric === k ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 relative">
        <ChartFitToggle fit={fit} />
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                tickFormatter={(v: number) => m.fmt(v)}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                width={56}
                domain={fit.clip ? [0, fit.cap] : undefined}
                allowDataOverflow={fit.clip}
              />
              <Tooltip content={<TrendTip metric={metric} />} />
              <Line
                type="monotone"
                dataKey={metric}
                stroke={m.color}
                strokeWidth={1.8}
                dot={false}
                connectNulls
                isAnimationActive
                animationDuration={650}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
            No {m.label} data in this window.
          </div>
        )}
      </div>
    </div>
  );
}

function TrendTip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; payload: FunnelDailyPoint }>;
  metric: Metric;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const m = METRICS[metric];
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg shadow-black/30 text-xs">
      <div className="text-ink-2 mb-1">{point.date}</div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-sm" style={{ background: m.color }} />
        <span className="text-ink-2">{m.label}</span>
        <span className="ml-auto text-ink tabular-nums">{m.fmt(point[metric])}</span>
      </div>
    </div>
  );
}
