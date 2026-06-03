"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { int, ratio, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignDailyPoint } from "@/db/queries/campaign";

type Metric =
  | "spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "conversionValue"
  | "roas";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactNum = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const METRICS: Record<
  Metric,
  {
    label: string;
    color: string;
    cell: (v: number | null) => string;
    axis: (v: number) => string;
  }
> = {
  spend: { label: "Spend", color: "#60A5FA", cell: usd, axis: (v) => compactUsd.format(v) },
  impressions: { label: "Impressions", color: "#A78BFA", cell: int, axis: (v) => compactNum.format(v) },
  clicks: { label: "Clicks", color: "#34D399", cell: int, axis: (v) => compactNum.format(v) },
  conversions: { label: "Conversions", color: "#FBBF24", cell: int, axis: (v) => compactNum.format(v) },
  conversionValue: { label: "Conv. value", color: "#22D3EE", cell: usd, axis: (v) => compactUsd.format(v) },
  roas: {
    label: "ROAS",
    color: "#F472B6",
    cell: (v) => (v === null ? "—" : `${ratio(v)}×`),
    axis: (v) => `${ratio(v)}×`,
  },
};
const ORDER: Metric[] = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversionValue",
  "roas",
];

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function CampaignTrendChart({ points }: { points: CampaignDailyPoint[] }) {
  const [metric, setMetric] = useState<Metric>("spend");
  const m = METRICS[metric];
  const hasData = points.some((p) => p[metric] != null);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 className="text-sm text-ink-2">Performance over time</h3>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMetric(key)}
              className={cn(
                "px-2.5 py-1 rounded transition-colors",
                metric === key
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              {METRICS[key].label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No data for this metric in the window.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => monthDay.format(new Date(d))}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                tickMargin={6}
              />
              <YAxis
                tickFormatter={(v: number) => m.axis(v)}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                width={56}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--ink-2)" }}
                labelFormatter={(d) => monthDay.format(new Date(d as string))}
                formatter={(value) => [
                  m.cell(typeof value === "number" ? value : null),
                  m.label,
                ]}
              />
              <Line
                type="monotone"
                dataKey={metric}
                stroke={m.color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
