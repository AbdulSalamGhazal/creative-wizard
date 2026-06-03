"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import { usd, ratio, pct, int } from "@/lib/format";
import type { CompareMetric, CompareSeriesPoint } from "@/db/queries/performance";

interface CreativeOption {
  id: string;
  name: string;
}

interface Props {
  rows: CompareSeriesPoint[];
  creatives: CreativeOption[];
  metric: CompareMetric;
}

const COLORS = ["#FF4D8D", "#5EE6A8", "#FFD166", "#6D8FFF", "#34D399"];

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function fmt(metric: CompareMetric, v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  switch (metric) {
    case "spend":
    case "cpm":
    case "cpc":
    case "cpa":
      return usd(v);
    case "ctr":
    case "cvr":
    case "hookRate":
      return pct(v);
    case "roas":
      return ratio(v);
    case "impressions":
    case "clicks":
    case "conversions":
      return int(v);
  }
}

export function CompareChart({ rows, creatives, metric }: Props) {
  type ChartRow = { date: string } & Record<string, string | number | null>;
  const data = useMemo<ChartRow[]>(() => {
    const byDate = new Map<string, ChartRow>();
    for (const r of rows) {
      const existing = byDate.get(r.date);
      if (existing) {
        existing[r.creativeId] = r.value;
        continue;
      }
      const fresh: ChartRow = { date: r.date };
      for (const c of creatives) fresh[c.id] = null;
      fresh[r.creativeId] = r.value;
      byDate.set(r.date, fresh);
    }
    return [...byDate.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [rows, creatives]);

  if (data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
        Pick two or more creatives to compare.
      </div>
    );
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => monthDay.format(new Date(d))}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            tickMargin={6}
          />
          <YAxis
            tickFormatter={(v: number) =>
              metric === "spend" || metric === "cpm" || metric === "cpc" || metric === "cpa"
                ? compactUsd.format(v)
                : metric === "ctr" || metric === "cvr" || metric === "hookRate"
                  ? `${(v * 100).toFixed(1)}%`
                  : v >= 1000
                    ? `${(v / 1000).toFixed(1)}k`
                    : String(v)
            }
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            width={56}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || !label) return null;
              return (
                <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
                  <div className="text-ink-2 mb-1.5">
                    {monthDay.format(new Date(label as string))}
                  </div>
                  <div className="space-y-1">
                    {payload.map((p) => {
                      const c = creatives.find((c) => c.id === p.dataKey);
                      return (
                        <div
                          key={String(p.dataKey)}
                          className="flex items-center gap-2 min-w-[180px]"
                        >
                          <span
                            className="w-2 h-2 rounded-sm shrink-0"
                            style={{ background: p.color }}
                          />
                          <span className="text-ink-2 truncate max-w-[120px]">
                            {c?.name ?? p.dataKey}
                          </span>
                          <span className="ml-auto text-ink num">
                            {fmt(metric, p.value as number | null)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />
          {creatives.map((c, i) => (
            <Line
              key={c.id}
              type="monotone"
              dataKey={c.id}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 2.5, fill: COLORS[i % COLORS.length], strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive
              animationDuration={700}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export { COLORS as COMPARE_COLORS };
